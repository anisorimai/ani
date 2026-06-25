"""
Chat router — HTTP POST (non-streaming) and WebSocket (streaming).

Routers are thin: they accept requests, delegate to the orchestrator,
and return responses. No business logic here.

WebSocket protocol (persistent connection — one connection, many messages):
  Client → {"token": str, "message": str, "conversation_id": str, "history": [...],
            "page": int, "request_id": str}
  Client → {"type": "ping"}                       heartbeat keepalive
  Client → {"type": "stop", "request_id": str}    abort the in-flight generation
  Server → {"token": str}                         streamed response chunk
  Server → {"done": true, ...meta}                end of one response
  Server → {"done": true, "stopped": true, ...}   response aborted by client stop
  Server → {"type": "pong"}                       heartbeat reply
  Server → {"error": str, "done": true}           non-fatal error; connection stays open

Every server frame belonging to a request echoes the client's "request_id"
(when one was supplied) so the client can discard late frames from a
stopped or superseded request.
"""

import asyncio
import json
import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from auth.dependencies import get_current_user
from auth.jwt_handler import decode_access_token
from models.requests import ChatRequest
from models.responses import ChatResponse
from orchestrator.query_orchestrator import get_orchestrator
from services.memory_service import get_memory_service

router = APIRouter()
logger = logging.getLogger("voxa.router.chat")


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    """Non-streaming chat. Returns the full standardised response in one HTTP reply."""
    orchestrator = get_orchestrator()
    memory = get_memory_service()

    history = (body.history or []) + memory.get_history(body.conversation_id)

    try:
        result = await orchestrator.process(
            query=body.message,
            session_id=body.conversation_id,
            conversation_history=history,
            page=body.page,
            user_id=str(current_user.get("id", "")),
            org_id=str(current_user.get("org_id") or ""),
            dashboard_context=body.dashboard_context,
        )
    except Exception as exc:
        logger.error("Orchestrator error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to process query")

    memory.append(body.conversation_id, body.message, result.response)

    return ChatResponse(
        success=result.success,
        response=result.response,
        conversation_id=body.conversation_id,
        source=result.source,
        intent=result.intent,
        data=result.data,
        insights=result.insights,
        collections_used=result.collections_used,
        confidence=result.confidence,
        latency_ms=result.latency_ms,
        followups=result.followups,
        citations=result.citations,
        metadata=result.metadata,
        total_records=result.metadata.get("pagination", {}).get("total_records", 0),
        page=result.metadata.get("pagination", {}).get("page", 1),
        page_size=result.metadata.get("pagination", {}).get("page_size", 50),
        total_pages=result.metadata.get("pagination", {}).get("total_pages", 1),
    )


@router.websocket("/stream")
async def stream(websocket: WebSocket):
    """
    Persistent WebSocket — one connection handles unlimited sequential messages.

    The connection stays open until the client disconnects. Each request/response
    cycle is self-contained: the client sends a message object, the server streams
    tokens, then sends a `done` frame, then waits for the next message.

    A single reader task owns `receive_text()` and feeds an inbox queue. While a
    response is streaming, the handler waits on BOTH the next token and the inbox,
    so a {"type": "stop"} control frame cancels the orchestrator pipeline
    immediately — including during the long pre-token stages (DB fetch, LLM
    narration start), not just between tokens.
    """
    await websocket.accept()
    ws_user_id = ""
    ws_org_id  = ""
    orchestrator = get_orchestrator()
    memory      = get_memory_service()
    logger.info("WebSocket connected")

    inbox: asyncio.Queue = asyncio.Queue()

    async def _reader() -> None:
        """Sole consumer of receive_text(); None in the inbox means disconnected."""
        try:
            while True:
                frame = await websocket.receive_text()
                await inbox.put(frame)
        except (WebSocketDisconnect, Exception):
            await inbox.put(None)

    reader_task = asyncio.create_task(_reader())

    try:
        while True:
            # ── Wait for next client frame ─────────────────────────────────
            raw = await inbox.get()
            if raw is None:
                logger.info(
                    "WebSocket client disconnected (user=%s)",
                    ws_user_id[:8] + "…" if ws_user_id else "anon",
                )
                break

            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            # ── Heartbeat ──────────────────────────────────────────────────
            if data.get("type") == "ping":
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:
                    break
                continue

            # ── Stray stop (nothing in flight) — ignore ────────────────────
            if data.get("type") == "stop":
                continue

            # ── Auth token (sent with every message so refresh works) ──────
            raw_token = data.get("token", "")
            if raw_token:
                try:
                    ws_payload = decode_access_token(raw_token)
                    ws_user_id = str(ws_payload.get("id", ""))
                    ws_org_id  = str(ws_payload.get("org_id") or "")
                except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError) as exc:
                    logger.warning("WebSocket token invalid: %s", exc)
                    try:
                        await websocket.send_json({"error": "Unauthorized", "done": True})
                    except Exception:
                        break
                    continue  # Don't close — client will refresh token and retry

            message = data.get("message", "").strip()
            if not message:
                continue

            conv_id           = data.get("conversation_id", "")
            history           = data.get("history", [])
            page              = int(data.get("page", 1))
            request_id        = str(data.get("request_id", "") or "")
            dashboard_context = str(data.get("dashboard_context", "") or "")

            def _frame(payload: dict) -> dict:
                """Echo the request_id on every frame of this request."""
                return {**payload, "request_id": request_id} if request_id else payload

            # ── Stream one response (cancellable mid-flight) ───────────────
            full_response: list[str] = []
            stopped      = False
            disconnected = False
            gen        = None
            token_task = None
            inbox_task = None
            try:
                full_history = history + memory.get_history(conv_id)

                gen = orchestrator.stream(
                    query=message,
                    session_id=conv_id,
                    conversation_history=full_history,
                    page=page,
                    user_id=ws_user_id,
                    org_id=ws_org_id,
                    dashboard_context=dashboard_context,
                )
                token_task = asyncio.create_task(gen.__anext__())
                inbox_task = asyncio.create_task(inbox.get())

                while True:
                    done, _ = await asyncio.wait(
                        {token_task, inbox_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    # Control frames first — stop / disconnect abort the stream
                    if inbox_task in done:
                        frame = inbox_task.result()
                        if frame is None:
                            disconnected = True
                        else:
                            try:
                                ctrl = json.loads(frame)
                            except json.JSONDecodeError:
                                ctrl = {}
                            if ctrl.get("type") == "ping":
                                await websocket.send_json({"type": "pong"})
                            elif ctrl.get("type") == "stop" and (
                                not ctrl.get("request_id") or ctrl.get("request_id") == request_id
                            ):
                                stopped = True
                            # Any other frame received mid-stream is ignored
                        if not (disconnected or stopped):
                            inbox_task = asyncio.create_task(inbox.get())

                    if disconnected or stopped:
                        token_task.cancel()
                        try:
                            await token_task
                        except (asyncio.CancelledError, StopAsyncIteration):
                            pass
                        except Exception:
                            pass
                        break

                    if token_task in done:
                        try:
                            token_chunk = token_task.result()
                        except StopAsyncIteration:
                            inbox_task.cancel()
                            break
                        await websocket.send_json(_frame({"token": token_chunk}))
                        full_response.append(token_chunk)
                        token_task = asyncio.create_task(gen.__anext__())

                if disconnected:
                    logger.info("WebSocket disconnected mid-stream")
                    break

                full_response_text = "".join(full_response)
                stream_meta = orchestrator.get_last_stream_meta(conv_id)

                if stopped:
                    logger.info(
                        "Generation stopped by client (conv=%s, %d chars streamed)",
                        conv_id, len(full_response_text),
                    )

                await websocket.send_json(_frame({
                    "done":             True,
                    "stopped":          stopped,
                    "followups":        [],
                    "intent":           stream_meta.get("intent", "data_query"),
                    "source":           stream_meta.get("source", "llm"),
                    "confidence":       stream_meta.get("confidence", 1.0),
                    "collections_used": stream_meta.get("collections_used", []),
                    "citations":        stream_meta.get("citations", []),
                    "pagination":       stream_meta.get("pagination"),
                    "query_understanding": stream_meta.get("query_understanding"),
                }))

                # A stopped-early response with no visible text is not history
                if full_response_text:
                    memory.append(conv_id, message, full_response_text)

            except Exception as exc:
                logger.error("WebSocket stream error: %s", exc, exc_info=True)
                try:
                    await websocket.send_json(_frame({
                        "error": "Something went wrong. Please try again.",
                        "done":  True,
                    }))
                except Exception:
                    break
                # Connection stays open — client can send next message
            finally:
                # Never leave an orphaned task running the pipeline
                for _t in (token_task, inbox_task):
                    if _t is not None and not _t.done():
                        _t.cancel()
                if gen is not None:
                    try:
                        await gen.aclose()
                    except Exception:
                        pass

    except Exception as exc:
        logger.error("WebSocket fatal error: %s", exc, exc_info=True)
    finally:
        reader_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info(
            "WebSocket closed (user=%s)",
            ws_user_id[:8] + "…" if ws_user_id else "anon",
        )
