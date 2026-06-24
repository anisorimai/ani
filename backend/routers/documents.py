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

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from pydantic import BaseModel

from database.mongodb import get_db
from services.storage_service import get_storage_service

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
    """Split an uploaded path into equipment anchor and filename."""
    normalized_path = raw_path.replace("\\", "/")
    parts = [p for p in normalized_path.split("/") if p]
    if len(parts) > 1:
        equipment = parts[0]
        filename = "/".join(parts[1:])
    else:
        equipment = "General"
        filename = parts[0] if parts else "document.pdf"
    return equipment, filename


def _derive_unit_tags(raw_path: str) -> list[str]:
    """Derive optional unit tags from path segments without creating hierarchy."""
    normalized_parts = [p.strip().lower() for p in raw_path.replace("\\", "/").split("/") if p.strip()]
    tag_map = {
        "manufacturing": "Manufacturing",
        "qc": "QC",
        "production": "Production",
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
    filename: str,
    file_bytes: bytes,
    equipment: str = "General",
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
        result = await index_document(
            db,
            user_id,
            filename,
            file_bytes,
            chunk_size=RAG_CHUNK_SIZE,
            chunk_overlap=RAG_CHUNK_OVERLAP,
            equipment=equipment,
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


@router.get("/")
async def list_documents():
    """
    List all documents in the plant-wide equipment repository, joined with RAG index status.
    """
    storage = get_storage_service()
    prefix = "equipment/"
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
        key = f"equipment/{equipment}/{filename}"
        storage_obj = storage_map.get(key)
        docs.append({
            "doc_id": record.get("doc_id"),
            "filename": filename,
            "equipment": equipment,
            "path": storage_obj.key if storage_obj else None,
            "url": storage_obj.url if storage_obj else None,
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

    raw_path = file.filename or ""
    equipment, filename = _parse_upload_path(raw_path)
    unit_tags = _derive_unit_tags(raw_path)

    key = f"equipment/{equipment}/{filename}"
    stored = get_storage_service().save_bytes(key, content, file.content_type)

    if ext in _RAG_SUPPORTED:
        background_tasks.add_task(_run_indexing, "", filename, content, equipment, unit_tags)
        rag_status = "processing"
    else:
        rag_status = "not_supported"
        logger.info("[DOCUMENTS] %s not RAG-indexed (extension %s not supported)", filename, ext)

    return {
        "status": "ok",
        "rag_status": rag_status,
        "document": {
            "filename": filename,
            "equipment": equipment,
            "path": stored.key,
            "url": stored.url,
            "size": stored.size,
            "updated_at": stored.updated_at.isoformat() if stored.updated_at else None,
            "unit_tags": unit_tags,
        },
    }


@router.delete("/{filename:path}")
async def delete_document(filename: str):
    """
    Delete a document from storage and remove all its RAG chunks and metadata.
    """
    db = get_db()
    if "/" in filename or "\\" in filename:
        from rag.document_store import parse_equipment_and_filename_from_key
        equipment, actual_filename = parse_equipment_and_filename_from_key(f"equipment/{filename}")
    else:
        from rag.document_store import RAG_DOCUMENTS_COLLECTION
        actual_filename = filename
        equipment = "General"
        if db is not None:
            doc_rec = await db[RAG_DOCUMENTS_COLLECTION].find_one({"filename": filename})
            if doc_rec:
                equipment = doc_rec.get("equipment", "General")

    key = f"equipment/{equipment}/{actual_filename}"

    # Remove from storage
    storage = get_storage_service()
    try:
        storage.delete(key)
    except Exception as exc:
        logger.warning("[DOCUMENTS] storage delete failed for key %s: %s", key, exc)

    # Remove RAG chunks and metadata record
    chunks_deleted = 0
    if db is not None:
        try:
            from rag.indexer import delete_document as rag_delete
            chunks_deleted = await rag_delete(db, "", actual_filename, equipment=equipment)
        except Exception as exc:
            logger.warning("[DOCUMENTS] RAG delete failed for %s: %s", actual_filename, exc)

    return {
        "status": "ok",
        "filename": actual_filename,
        "equipment": equipment,
        "chunks_deleted": chunks_deleted,
    }


@router.get("/index-status")
async def get_index_status():
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
async def debug_rag(query: str = ""):
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
        chunks, filenames = await retrieve_chunks(db, query_vector, query, "", top_k=5)
        result["test_query"] = query
        result["test_retrieval"] = {
            "chunks_found": len(chunks),
            "filenames": filenames,
            "top_chunk_text": chunks[0]["text"][:300] if chunks else None,
            "top_chunk_score": chunks[0].get("score") if chunks else None,
        }

    return result


@router.post("/query")
async def query_plant_knowledge(body: QueryRequest):
    """
    Query the shared plant knowledge base with optional equipment scoping.
    """
    if not body.question or not body.question.strip():
        raise HTTPException(status_code=400, detail="Question is required")

    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    from config.settings import PLANT_NAME, RAG_TOP_K
    from llm.client import LLMClient
    from orchestrator.semantic_expander import get_query_embedding
    from rag.retriever import retrieve_chunks

    query_vector = await get_query_embedding(body.question) if os.getenv("EMBEDDING_MODEL") else None
    chunks, filenames = await retrieve_chunks(
        db,
        query_vector,
        body.question,
        "",
        top_k=RAG_TOP_K,
        intent="conversational",
    )

    if body.equipment:
        equipment_filter = body.equipment.strip().lower()
        chunks = [
            chunk for chunk in chunks
            if (chunk.get("equipment") or "").lower() == equipment_filter
        ]

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
        source = f"{chunk.get('equipment', 'General')} / {chunk.get('filename', 'unknown')}"
        context_blocks.append(f"[{idx}] Source: {source}\n{chunk.get('text', '')}")

    llm = LLMClient()
    system_prompt = (
        f"You are answering questions from the plant knowledge base for {PLANT_NAME}. "
        "Use only the provided context. If the context is insufficient, say so plainly. "
        "Do not invent steps, dates, or equipment details. Keep the answer concise and "
        "reference the source files when helpful."
    )
    answer = llm.complete([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Question: {body.question}\n\nContext:\n" + "\n\n".join(context_blocks)},
    ])

    return {
        "answer": answer,
        "sources": filenames,
        "chunks_used": len(chunks),
        "equipment": body.equipment,
    }
