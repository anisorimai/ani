"""
ANI-VOXA Backend — Main Entry Point
FastAPI application with async MongoDB, provider-agnostic LLM, and
extensible data ingestion.
"""

import asyncio
import logging
import sys
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

# ── Path shim — lets 'from services.x import y' work whether this file is
#    run from repo root or from inside backend/.
BACKEND_DIR = Path(__file__).parent.resolve()
ROOT_DIR = BACKEND_DIR.parent
for p in (str(ROOT_DIR), str(BACKEND_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config.settings import HOST, PORT, CORS_ORIGINS, CORS_ORIGIN_REGEX, DATA_DIR, LLM_API_KEY, LLM_PROVIDER
from database.mongodb import connect_db, close_db, get_db
from services.stt_service import init_stt_service
from services.storage_service import verify_storage
from orchestrator.query_orchestrator import get_orchestrator

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("voxa.main")


async def _startup(app: FastAPI) -> None:
    """
    Background initialisation — runs after MongoDB is already connected.
    Heavy work (data ingestion, orchestrator discovery, STT) runs here so it
    doesn't block the first login/signup request on a cold start.
    """
    logger.info("Background initialisation started…")
    app.state.ready = False

    db = get_db()

    if db is not None:
        # 1. Ingest data files (CSV / JSON from DATA_DIR) — optional module
        try:
            from data_ingestion.loader import ingest_directory
            counts = await ingest_directory(db)
            if counts:
                logger.info(f"Data ingestion complete: {counts}")
            else:
                logger.info("No new data files to ingest (all collections already populated)")
        except ImportError:
            logger.info("data_ingestion module not available — skipping file ingestion")
        except Exception as exc:
            logger.error(f"Data ingestion error: {exc}")

        # 2. RAG indexes (creates {doc_id} and {user_id, doc_id} indexes on rag_chunks)
        try:
            from rag.document_store import init_rag_indexes
            await init_rag_indexes(db)
        except Exception as exc:
            logger.warning(f"RAG index init deferred: {exc}")

        try:
            from rag.equipment_registry import init_equipment_indexes
            await init_equipment_indexes(db)
        except Exception as exc:
            logger.warning(f"Equipment index init deferred: {exc}")

        # 3. Orchestrator
        try:
            orchestrator = get_orchestrator()
            await orchestrator.initialise()
        except Exception as exc:
            logger.warning(f"Orchestrator initialisation deferred: {exc}")
    else:
        logger.warning("MongoDB not connected — running without database")

    # 4. STT
    try:
        init_stt_service()
    except Exception as exc:
        logger.warning(f"STT init skipped: {exc}")

    # 5. Storage verification (must never block startup)
    try:
        verify_storage()
    except Exception as exc:
        logger.warning("Storage verification skipped: %s", exc)

    # ── LLM API key check ──
    if not LLM_API_KEY:
        logger.error(
            "LLM_API_KEY is not set — chat and voice features will not work. "
            "Add LLM_API_KEY to backend/.env"
        )
    else:
        logger.info(f"LLM provider: {LLM_PROVIDER}")

    app.state.ready = True
    logger.info("ANI-VOXA backend is READY")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connect to MongoDB synchronously — auth endpoints need it on the very
    # first request (Render cold starts would otherwise return 401 on login).
    await connect_db()
    # Everything else (data ingestion, orchestrator, STT) runs in the background.
    asyncio.create_task(_startup(app))
    yield
    await close_db()
    logger.info("ANI-VOXA backend shut down")


# ── Application ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="ANI-VOXA",
    description="AI-powered voice and data assistant backend",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    start = time.perf_counter()
    client = request.client.host if request.client else "unknown"
    logger.info(
        "HTTP start request_id=%s method=%s path=%s client=%s",
        request_id,
        request.method,
        request.url.path,
        client,
    )
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.exception(
            "HTTP error request_id=%s method=%s path=%s elapsed_ms=%s",
            request_id,
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise

    elapsed_ms = int((time.perf_counter() - start) * 1000)
    response.headers["x-request-id"] = request_id
    logger.info(
        "HTTP done request_id=%s method=%s path=%s status=%s elapsed_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response

# ── Routers ────────────────────────────────────────────────────────────────────
from routers import health, auth, chat, speech, history, documents, query, dashboard  # noqa: E402

app.include_router(health.router,     prefix="/api",           tags=["Health"])
app.include_router(auth.router,       prefix="/api/auth",      tags=["Auth"])
app.include_router(chat.router,       prefix="/api",           tags=["Chat"])
app.include_router(speech.router,     prefix="/api",           tags=["Speech"])
app.include_router(query.router,      prefix="/api",           tags=["Query"])
app.include_router(history.router,    prefix="/api",           tags=["History"])
app.include_router(documents.router,  prefix="/api/documents", tags=["Documents"])
app.include_router(dashboard.router,  prefix="/api",           tags=["Dashboard"])

# ── Static uploads ─────────────────────────────────────────────────────────────
_uploads_dir = DATA_DIR / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


@app.get("/")
async def root():
    return {
        "name": "ANI-VOXA",
        "version": "2.0.0",
        "ready": getattr(app.state, "ready", False),
        "docs": "/docs",
        "health": "/api/health",
        "llm_provider": LLM_PROVIDER,
        "llm_configured": bool(LLM_API_KEY),
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
