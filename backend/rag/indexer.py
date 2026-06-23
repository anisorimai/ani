"""
Document indexer — orchestrates the full index pipeline for one uploaded file.

Crash-safe ordering
-------------------
  Stage A  Upsert rag_documents → index_status=pending      ← commit point A
  Stage 1  Extract text
  Stage 2  Chunk text
  Stage 3  Embed chunks (batched)
  Stage B  delete_document_chunks(doc_id)                   ← idempotent cleanup
  Stage B  Insert new chunks into rag_chunks                ← commit point B
  Stage C  Upsert rag_documents → index_status=indexed      ← commit point C

If a crash occurs between A and B: status stays 'pending', chunks are clean → safe to retry.
If a crash occurs between B and C: chunks exist but status is still 'pending' → safe to
  retry (Stage B cleans them before re-inserting).
'indexed' status is only written AFTER all chunks are committed — it is the commit marker.

Scopes
------
Pass scope="org" and org_id=<org_id> when indexing admin-uploaded reference documents.
The default scope="user" preserves existing per-user behaviour.
"""

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import motor.motor_asyncio

from rag.chunker import chunk_text
from rag.document_store import (
    compute_file_hash,
    delete_document_chunks,
    delete_document_record,
    get_document_record,
    insert_chunks,
    make_doc_id,
    make_org_doc_id,
    update_document_status,
    upsert_document_record,
    parse_equipment_and_filename_from_key,
)
from rag.embedder import embed_texts
from rag.extractor import IMAGE_EXTENSIONS, extract_image, extract_text

logger = logging.getLogger("voxa.rag.indexer")


async def index_document(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    user_id: str,
    filename: str,
    file_bytes: bytes,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
    scope: str = "user",
    org_id: Optional[str] = None,
    equipment: str = "General",
) -> dict:
    """
    Full indexing pipeline for one document.

    Returns:
      {doc_id, chunk_count, index_status, skipped}

    skipped=True means the file was already indexed with the same content hash —
    no embedding API calls were made.
    """
    doc_id = make_doc_id(equipment, filename)

    file_hash = compute_file_hash(file_bytes)
    file_size = len(file_bytes)
    embedding_model = os.getenv("EMBEDDING_MODEL", "")

    # ── Skip if identical file is already indexed ─────────────────────────────
    existing = await get_document_record(db, doc_id)
    if (
        existing
        and existing.get("file_hash") == file_hash
        and existing.get("index_status") == "indexed"
    ):
        logger.info(
            "[INDEXER] skipped — identical file already indexed: %s (chunks=%s)",
            filename, existing.get("chunk_count"),
        )
        return {
            "doc_id": doc_id,
            "chunk_count": existing.get("chunk_count", 0),
            "index_status": "indexed",
            "skipped": True,
        }

    # ── Stage A: mark as pending ──────────────────────────────────────────────
    await upsert_document_record(
        db,
        doc_id=doc_id,
        user_id=user_id,
        filename=filename,
        file_hash=file_hash,
        file_size_bytes=file_size,
        index_status="pending",
        embedding_model=embedding_model,
        scope=scope,
        org_id=org_id,
        equipment=equipment,
    )

    try:
        # ── Stage 1: extract ──────────────────────────────────────────────────
        ext = Path(filename).suffix.lower()
        image_meta: dict = {}
        partial_index: bool = False

        if ext in IMAGE_EXTENSIONS:
            storage_key = f"equipment/{equipment}/{filename}"
            text, strategy, image_meta = await extract_image(file_bytes, filename, storage_key)
        else:
            text, strategy = extract_text(file_bytes, filename)
            # Flag large files that yielded suspiciously little text — likely image-heavy
            partial_index = file_size > 50_000 and len(text.strip()) < 200

        if not text.strip():
            await update_document_status(
                db, doc_id, "failed", error_message="No text could be extracted"
            )
            logger.warning("[INDEXER] no text extracted from %s", filename)
            return {"doc_id": doc_id, "chunk_count": 0, "index_status": "failed", "skipped": False}

        # ── Stage 2: chunk ────────────────────────────────────────────────────
        chunks = chunk_text(text, strategy, chunk_size=chunk_size, overlap=chunk_overlap)
        if not chunks:
            await update_document_status(
                db, doc_id, "failed", error_message="Chunking produced no output"
            )
            return {"doc_id": doc_id, "chunk_count": 0, "index_status": "failed", "skipped": False}

        # ── Stage 3: embed ────────────────────────────────────────────────────
        vectors = await embed_texts(chunks)

        # Detect partial embedding failure — any None in a batch means that batch
        # failed.  Mark the document failed so it can be retried rather than
        # silently persisting an incomplete index.
        if embedding_model and any(v is None for v in vectors):
            failed_count = sum(1 for v in vectors if v is None)
            await update_document_status(
                db, doc_id, "failed",
                error_message=f"Embedding failed for {failed_count}/{len(vectors)} chunks",
            )
            logger.error(
                "[INDEXER] partial embedding failure for %s: %d/%d chunks",
                filename, failed_count, len(vectors),
            )
            return {"doc_id": doc_id, "chunk_count": 0, "index_status": "failed", "skipped": False}

        # ── Stage B: remove stale chunks, insert fresh ────────────────────────
        deleted = await delete_document_chunks(db, doc_id)
        if deleted:
            logger.info("[INDEXER] removed %d stale chunks for %s", deleted, filename)

        now = datetime.now(timezone.utc)
        chunk_docs = [
            {
                "doc_id": doc_id,
                "user_id": user_id,
                "equipment": equipment,
                "filename": filename,
                "chunk_index": i,
                "chunk_strategy": strategy.value,
                "text": chunk,
                "embedding": vectors[i],  # None when EMBEDDING_MODEL not set
                "indexed_at": now,
                "scope": scope,
                "org_id": org_id,
                **image_meta,  # empty dict for non-images; full metadata for image chunks
            }
            for i, chunk in enumerate(chunks)
        ]
        await insert_chunks(db, chunk_docs)

        # ── Stage C: mark as indexed ──────────────────────────────────────────
        await upsert_document_record(
            db,
            doc_id=doc_id,
            user_id=user_id,
            filename=filename,
            file_hash=file_hash,
            file_size_bytes=file_size,
            index_status="indexed",
            chunk_strategy=strategy.value,
            embedding_model=embedding_model,
            chunk_count=len(chunks),
            indexed_at=now,
            partial_index=partial_index,
            scope=scope,
            org_id=org_id,
            equipment=equipment,
        )

        logger.info(
            "[INDEXER] indexed %s → %d chunks (strategy=%s, embeddings=%s, equipment=%s)",
            filename, len(chunks), strategy.value,
            "yes" if embedding_model else "no", equipment,
        )
        return {
            "doc_id": doc_id,
            "chunk_count": len(chunks),
            "index_status": "indexed",
            "skipped": False,
        }

    except Exception as exc:
        logger.error("[INDEXER] failed for %s: %s", filename, exc, exc_info=True)
        await update_document_status(db, doc_id, "failed", error_message=str(exc))
        return {
            "doc_id": doc_id,
            "chunk_count": 0,
            "index_status": "failed",
            "skipped": False,
        }


async def delete_document(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    user_id: str,
    filename: str,
    scope: str = "user",
    org_id: Optional[str] = None,
    equipment: str = "General",
) -> int:
    """
    Remove all chunks and the metadata record for a document.
    Returns the number of chunks deleted.
    """
    if "/" in filename or "\\" in filename:
        equipment, filename = parse_equipment_and_filename_from_key(f"equipment/{filename}")

    doc_id = make_doc_id(equipment, filename)

    chunks_deleted = await delete_document_chunks(db, doc_id)
    await delete_document_record(db, doc_id)
    logger.info("[INDEXER] deleted %s: %d chunks removed (equipment=%s)", filename, chunks_deleted, equipment)
    return chunks_deleted
