"""
Documents router — plant-wide ELT document ingestion and knowledge retrieval.

Upload flow (async indexing):
  1. Validate file type and content
  2. Save to storage backend (local disk or Supabase)
  3. Kick off RAG indexing in a FastAPI BackgroundTask — returns immediately
  4. Client polls GET /api/documents/index-status to track progress

The background task handles: extract → chunk → embed → store in a single
plant-wide RAG index. Unit tags are stored as soft metadata only and do not
create separate indexes or per-unit pipelines.
"""

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from auth.dependencies import get_current_user
from config.settings import DATA_DIR, EMBEDDING_MODEL
from database.mongodb import get_db
from rag.equipment_registry import delete_equipment_if_empty, list_equipment_by_scope, upsert_equipment
from rag.path_parser import parse_upload_path
from services.storage_service import LocalStorageService, get_storage_service

router = APIRouter()
logger = logging.getLogger("voxa.router.documents")

ALLOWED_EXTENSIONS = {
    ".txt", ".md", ".pdf", ".csv", ".json",
    ".doc", ".docx", ".xls", ".xlsx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
}

# Extensions the RAG indexer knows how to extract text from.
# Others are stored but not indexed (no error — just no chunks).
_RAG_SUPPORTED = {
    ".txt", ".md", ".pdf", ".docx", ".csv", ".json",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
}


def _parse_upload_path(raw_path: str) -> tuple[str, str]:
    parsed = parse_upload_path(raw_path)
    return parsed.equipment_name, parsed.filename


def _derive_unit_tags(raw_path: str) -> list[str]:
    """Derive optional unit tags from path segments without creating hierarchy."""
    normalized_parts = [p.strip().lower() for p in raw_path.replace("\\", "/").split("/") if p.strip()]
    tag_map = {
        "production":  "Production",
        "quality":     "Quality",
        "qc":          "QC",
        "engineering": "Engineering",
    }
    tags: list[str] = []
    for part in normalized_parts[:-1]:
        tag = tag_map.get(part)
        if tag and tag not in tags:
            tags.append(tag)
    return tags


async def _run_indexing(
    user_id: str,
    storage_key: str,
    filename: str,
    file_bytes: bytes,
    dashboard_scope: str,
    equipment_name: str,
    document_type: str,
    source_url: Optional[str] = None,
    unit_tags: Optional[list[str]] = None,
) -> None:
    """Background task: run the full RAG indexing pipeline for one uploaded file."""
    db = get_db()
    if db is None:
        logger.warning("[DOCUMENTS] background indexing skipped — DB unavailable: %s", filename)
        return
    try:
        from config.settings import RAG_CHUNK_SIZE, RAG_CHUNK_OVERLAP
        from rag.indexer import index_document
        await upsert_equipment(
            db,
            dashboard_scope=dashboard_scope,
            equipment_name=equipment_name,
            document_type=document_type,
            filename=filename,
            source_url=source_url,
        )
        result = await index_document(
            db,
            user_id,
            filename,
            file_bytes,
            chunk_size=RAG_CHUNK_SIZE,
            chunk_overlap=RAG_CHUNK_OVERLAP,
            equipment=equipment_name,
            dashboard_scope=dashboard_scope,
            document_type=document_type,
            source_url=source_url,
            unit_tags=unit_tags or [],
        )
        logger.info(
            "[DOCUMENTS] indexing complete: %s status=%s chunks=%d skipped=%s",
            filename, result["index_status"], result["chunk_count"], result["skipped"],
        )
    except Exception as exc:
        logger.error("[DOCUMENTS] background indexing failed for %s: %s", filename, exc, exc_info=True)


class QueryRequest(BaseModel):
    question: str
    equipment: Optional[str] = None
    dashboard_scope: str = "enterprise"
    list_equipment_only: bool = False


@router.get("/")
async def list_documents(
    scope: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """
    List all documents in the plant-wide equipment repository, joined with RAG index status.
    """
    storage = get_storage_service()
    scope_key = (scope or "").strip().lower()
    prefix_map = {
        "quality":    "enterprise/quality/",
        "production": "enterprise/production/",
        "general":    "enterprise/general/",
    }
    prefix = prefix_map.get(scope_key, "enterprise/")
    stored = storage.list_prefix(prefix=prefix)

    storage_keys = [d.key for d in stored]
    storage_map = {d.key: d for d in stored}

    db = get_db()
    if db is None:
        # Fallback: return storage-only records with no index status
        docs = []
        for d in stored:
            from rag.document_store import parse_equipment_and_filename_from_key
            equipment, filename = parse_equipment_and_filename_from_key(d.key)
            docs.append({
                "filename": filename,
                "equipment": equipment,
                "path": d.key,
                "url": d.url,
                "source_url": d.url,
                "size": d.size,
                "updated_at": d.updated_at.isoformat() if d.updated_at else None,
                "index_status": "unknown",
                "chunk_count": None,
            })
        return {"documents": docs}

    from rag.document_store import list_user_documents
    rag_records = await list_user_documents(db, "", storage_keys)

    docs = []
    for record in rag_records:
        equipment = record.get("equipment", "General")
        filename = record.get("filename")
        storage_candidates = [obj for obj in stored if obj.key.endswith(f"/{filename}")]
        if equipment and equipment != "General":
            storage_obj = next(
                (obj for obj in storage_candidates if equipment.lower() in obj.key.lower()),
                storage_candidates[0] if storage_candidates else None,
            )
        else:
            storage_obj = storage_candidates[0] if storage_candidates else None
        docs.append({
            "doc_id": record.get("doc_id"),
            "filename": filename,
            "equipment": equipment,
            "path": storage_obj.key if storage_obj else None,
            "url": storage_obj.url if storage_obj else None,
            "source_url": storage_obj.url if storage_obj else None,
            "size": storage_obj.size if storage_obj else None,
            "updated_at": storage_obj.updated_at.isoformat() if storage_obj and storage_obj.updated_at else None,
            "index_status": record.get("index_status"),
            "chunk_count": record.get("chunk_count"),
            "indexed_at": record.get("indexed_at").isoformat() if record.get("indexed_at") else None,
            "chunk_strategy": record.get("chunk_strategy"),
            "error_message": record.get("error_message"),
        })

    return {"documents": docs}


@router.post("/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    scope: str = Form(""),
    equipment: Optional[str] = Form(None),
    document_type: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload a document. Saves to storage under equipment folder, then indexes in background.
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    scope_value = (scope or "general").strip().lower()
    if not scope_value:
        scope_value = "general"
    if scope_value not in {"quality", "production", "general"}:
        raise HTTPException(status_code=400, detail="scope must be one of: quality, production, general")

    equipment_value = (equipment or "").strip() if equipment is not None else ""
    if scope_value in {"quality", "production"} and not equipment_value:
        raise HTTPException(status_code=400, detail="equipment is required for quality and production uploads")

    if scope_value == "general":
        virtual_path = f"general/{file.filename}"
        storage_path = f"enterprise/general/{file.filename}"
        parsed_equipment = "General"
    else:
        virtual_path = f"{scope_value}/{equipment_value}/{file.filename}"
        storage_path = f"enterprise/{scope_value}/{equipment_value}/{file.filename}"
        parsed_equipment = equipment_value

    parsed = parse_upload_path(virtual_path)
    unit_tags = _derive_unit_tags(raw_path=file.filename or "")

    storage = get_storage_service()
    storage_warning = None
    try:
        stored = storage.save_bytes(storage_path, content, file.content_type)
    except Exception as exc:
        logger.error("[DOCUMENTS] Supabase upload failed for %s: %s", file.filename, exc, exc_info=True)
        try:
            stored = LocalStorageService(base_dir=DATA_DIR / "uploads").save_bytes(storage_path, content, file.content_type)
            storage_warning = "Supabase unavailable, stored locally"
        except Exception as local_exc:
            logger.error("[DOCUMENTS] local fallback failed for %s: %s", file.filename, local_exc, exc_info=True)
            raise HTTPException(status_code=500, detail="Storage upload failed") from local_exc

    if ext in _RAG_SUPPORTED:
        background_tasks.add_task(
            _run_indexing,
            "",
            storage_path,
            parsed.filename,
            content,
            scope_value if scope_value != "general" else "enterprise",
            parsed_equipment,
            document_type or parsed.document_type,
            stored.url,
            unit_tags,
        )
        rag_status = "processing"
    else:
        rag_status = "not_supported"
        logger.info("[DOCUMENTS] %s not RAG-indexed (extension %s not supported)", file.filename, ext)

    return {
        "status": "ok",
        "rag_status": rag_status,
        "document": {
            "filename": parsed.filename,
            "equipment": parsed_equipment,
            "dashboard_scope": scope_value if scope_value != "general" else "enterprise",
            "document_type": document_type or parsed.document_type,
            "storage_key": storage_path,
            "path": stored.key,
            "url": stored.url,
            "size": stored.size,
            "updated_at": stored.updated_at.isoformat() if stored.updated_at else None,
            "unit_tags": unit_tags,
            "storage_warning": storage_warning,
        },
    }


@router.delete("/{filepath:path}")
async def delete_document(filepath: str, current_user: dict = Depends(get_current_user)):
    """
    Delete a document from storage and remove all its RAG chunks and metadata.
    """
    db = get_db()
    normalized_path = (filepath or "").replace("\\", "/").strip("/")
    parts = [part for part in normalized_path.split("/") if part]

    if parts and parts[0] == "enterprise" and len(parts) >= 3:
        storage_key = "/".join(parts)
        dashboard_scope = parts[1] if parts[1] in {"quality", "production", "general"} else "enterprise"
        equipment_name = parts[2] if dashboard_scope != "general" else "General"
        filename = parts[-1]
    else:
        parsed = parse_upload_path(filepath)
        storage_key = parsed.storage_key
        dashboard_scope = parsed.dashboard_scope
        equipment_name = parsed.equipment_name
        filename = parsed.filename

    storage = get_storage_service()
    try:
        storage.delete(storage_key)
    except Exception as exc:
        logger.warning("[DOCUMENTS] storage delete failed for key %s: %s", storage_key, exc)

    chunks_deleted = 0
    if db is not None:
        try:
            from rag.indexer import delete_document as rag_delete
            chunks_deleted = await rag_delete(db, "", filename, equipment=equipment_name)
        except Exception as exc:
            logger.warning("[DOCUMENTS] RAG delete failed for %s: %s", filename, exc)

    if db is not None:
        await delete_equipment_if_empty(
            db,
            dashboard_scope,
            equipment_name,
            filename,
        )

    return {
        "status": "ok",
        "filename": filename,
        "equipment": equipment_name,
        "dashboard_scope": dashboard_scope,
        "chunks_deleted": chunks_deleted,
    }


@router.get("/equipment")
async def list_all_equipment(current_user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    equipment = await list_equipment_by_scope(db, None)
    return {"equipment": equipment, "total": len(equipment)}


@router.get("/equipment/production")
async def list_production_equipment(current_user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    equipment = await list_equipment_by_scope(db, "production")
    return {"equipment": equipment, "total": len(equipment), "dashboard_scope": "production"}


@router.get("/equipment/quality")
async def list_quality_equipment(current_user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    equipment = await list_equipment_by_scope(db, "quality")
    return {"equipment": equipment, "total": len(equipment), "dashboard_scope": "quality"}


@router.get("/index-status")
async def get_index_status(current_user: dict = Depends(get_current_user)):
    """
    Return RAG index health plant-wide.
    """
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from rag.document_store import get_index_health
    health = await get_index_health(db, "")
    return {"index_health": health}


@router.get("/debug")
async def debug_rag(query: str = "", current_user: dict = Depends(get_current_user)):
    """
    Debug endpoint — inspect what is stored in rag_chunks plant-wide.
    """
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from rag.document_store import RAG_CHUNKS_COLLECTION, RAG_DOCUMENTS_COLLECTION

    total_chunks = await db[RAG_CHUNKS_COLLECTION].count_documents({})
    sample_cursor = db[RAG_CHUNKS_COLLECTION].find(
        {},
        {"_id": 0, "filename": 1, "equipment": 1, "chunk_index": 1, "text": 1, "embedding": 1},
    ).limit(3)
    sample_chunks = await sample_cursor.to_list(length=3)

    chunk_preview = []
    for c in sample_chunks:
        has_embedding = c.get("embedding") is not None and len(c.get("embedding", [])) > 0
        chunk_preview.append({
            "filename": c.get("filename"),
            "equipment": c.get("equipment"),
            "chunk_index": c.get("chunk_index"),
            "text_preview": (c.get("text") or "")[:200],
            "text_length": len(c.get("text") or ""),
            "has_embedding": has_embedding,
            "embedding_dims": len(c.get("embedding") or []),
        })

    doc_cursor = db[RAG_DOCUMENTS_COLLECTION].find(
        {},
        {"_id": 0, "filename": 1, "equipment": 1, "index_status": 1, "chunk_count": 1,
         "embedding_model": 1, "error_message": 1},
    )
    doc_records = await doc_cursor.to_list(length=20)

    result = {
        "total_chunks_in_db": total_chunks,
        "documents": doc_records,
        "chunk_sample": chunk_preview,
    }

    if query:
        from orchestrator.semantic_expander import get_query_embedding
        from rag.retriever import retrieve_chunks
        query_vector = await get_query_embedding(query) if os.getenv("EMBEDDING_MODEL") else None
        chunks, filenames, _ = await retrieve_chunks(db, query_vector, query, "", top_k=5)
        result["test_query"] = query
        result["test_retrieval"] = {
            "chunks_found": len(chunks),
            "filenames": filenames,
            "top_chunk_text": chunks[0]["text"][:300] if chunks else None,
            "top_chunk_score": chunks[0].get("score") if chunks else None,
        }

    return result


@router.post("/query")
async def query_plant_knowledge(body: QueryRequest, current_user: dict = Depends(get_current_user)):
    """
    Query the shared plant knowledge base with optional equipment scoping.
    """
    if not body.question or not body.question.strip():
        raise HTTPException(status_code=400, detail="Question is required")

    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    if body.list_equipment_only:
        scope = None if body.dashboard_scope == "enterprise" else body.dashboard_scope
        equipment_entries = await list_equipment_by_scope(db, scope)
        lines = [f"- {entry['display_name']} ({entry['dashboard_scope']})" for entry in equipment_entries]
        answer = "Available instruments:\n" + ("\n".join(lines) if lines else "- None")
        return {
            "answer": answer,
            "sources": equipment_entries,
            "chunks_used": 0,
            "disclaimer": "Equipment registry entries only.",
        }

    from config.settings import PLANT_NAME, RAG_TOP_K
    from llm.client import LLMClient
    from orchestrator.semantic_expander import get_query_embedding
    from rag.retriever import retrieve_chunks

    query_vector = await get_query_embedding(body.question) if EMBEDDING_MODEL else None
    chunks, filenames, _ = await retrieve_chunks(
        db,
        query_vector,
        body.question,
        "",
        top_k=RAG_TOP_K,
        intent="conversational",
        dashboard_scope=body.dashboard_scope,
    )

    if not chunks:
        return {
            "answer": (
                "I could not find enough relevant plant knowledge for that question. "
                "Try a more specific question or upload supporting documents."
            ),
            "sources": [],
            "chunks_used": 0,
            "equipment": body.equipment,
        }

    context_blocks = []
    for idx, chunk in enumerate(chunks[:5], start=1):
        metadata = chunk.get("metadata") or {}
        source_url = metadata.get("source_url") or ""
        source_label = f"{chunk.get('equipment', 'General')} / {chunk.get('filename', 'unknown')}"
        if source_url:
            source_label = f"{source_label} | url: {source_url}"
        context_blocks.append(f"[{idx}] Source: {source_label}\n{chunk.get('text', '')}")

    llm = LLMClient()
    system_prompt = (
        f"You are answering questions from the plant knowledge base for {PLANT_NAME}. "
        "Use only the provided context. If the context is insufficient, say so plainly. "
        "Do not invent steps, dates, or equipment details. Keep the answer concise and "
        "end every answer with a Sources section. When a source line contains a | url: value, "
        "format the citation in the Sources section as [filename](url). Otherwise cite as "
        "filename (Equipment: equipment_name). Only cite documents actually referenced in the answer."
    )
    answer = llm.complete([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Question: {body.question}\n\nContext:\n" + "\n\n".join(context_blocks)},
    ])

    sources = []
    for chunk in chunks:
        metadata = chunk.get("metadata") or {}
        sources.append({
            "filename": chunk.get("filename"),
            "equipment": chunk.get("equipment"),
            "dashboard_scope": metadata.get("dashboard_scope", "enterprise"),
            "document_type": metadata.get("document_type", "manual"),
            "source_url": metadata.get("source_url"),
            "department_priority": metadata.get("department_priority"),
        })

    return {
        "answer": answer,
        "sources": sources,
        "chunks_used": len(chunks),
        "equipment": body.equipment,
    }
