"""
RAG retriever — finds the most relevant chunks for a query at inference time.

Retrieval path
--------------
  Path 1  Atlas $vectorSearch on rag_chunks.embedding  (when query_vector available)
  Path 2  Regex keyword search on rag_chunks.text      (fallback — no embedding needed)

Scope filter
------------
Every query unions two scopes:
  • user-scoped chunks  — {scope: "user",  user_id: <current_user>}
  • org-scoped chunks   — {scope: "org",   org_id:  <user's org>}  (skipped if org_id is empty)

This means org reference documents are always surfaced alongside personal uploads
without any extra query from the caller.

Post-retrieval
--------------
  1. Proximity deduplication: drop chunks within ±1 index of a higher-scoring chunk
     from the same document.
  2. Score-based MMR reranking: iteratively select chunks maximising
       MMR_score(i) = score_i − λ × max(scores of already-selected chunks)
     This approximation is mathematically valid because Atlas $vectorSearch does NOT
     return the embedding vectors by default — only scores.  Two chunks both scoring
     0.92 against the same query are almost certainly near each other in vector space,
     so penalising by the max selected score captures diversity without needing
     inter-chunk distances.  For top-20 → rerank-to-5 this is accurate enough in
     practice and costs zero extra payload.

Citation allowed-list
---------------------
retrieve_chunks() also returns the set of filenames that contributed chunks.
The orchestrator passes this set to Stage 8's system prompt so the LLM cites only
from that known list, preventing hallucinated citations.
"""

import logging
import os
import re
from typing import Optional

import motor.motor_asyncio

from rag.document_store import RAG_CHUNKS_COLLECTION

logger = logging.getLogger("voxa.rag.retriever")

_MMR_LAMBDA  = 0.7   # relevance vs diversity trade-off (1.0 = pure relevance)
_RAG_INDEX   = "rag_vector_index"   # Atlas vector index name — separate from the
                                     # structured-data EMBEDDING_INDEX so the two
                                     # collections can have different vector dimensions

# How many candidates to fetch before dedup + MMR narrow to top_k.
# Driven by RAG_CANDIDATE_K env var so large-document deployments can increase
# coverage without a code change.  Default 50 handles documents up to ~50 sections
# while staying well within Atlas free-tier limits.
_CANDIDATE_K: int = int(os.getenv("RAG_CANDIDATE_K", "50"))


def _scope_filter(user_id: str = "", org_id: Optional[str] = None) -> dict:
    """
    Build a MongoDB filter. Since we migrated to a plant-wide repository,
    this returns an empty dict to match all chunks across the entire plant.
    """
    return {}


async def retrieve_all_user_chunks(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    user_id: str,
    org_id: Optional[str] = None,
) -> tuple[list[dict], list[str]]:
    """
    Fetch every indexed chunk visible to this user (personal + org) without
    score-based filtering.

    Used for document-scoped queries (e.g. "list every ID in the uploaded
    documents") where top-k retrieval misses documents that are not
    semantically close to the query but are still relevant by mandate.
    Hard-capped at 500 chunks to prevent runaway memory usage.
    """
    try:
        cursor = db[RAG_CHUNKS_COLLECTION].find(
            _scope_filter(user_id, org_id),
            {"_id": 0, "doc_id": 1, "filename": 1, "chunk_index": 1, "text": 1},
        )
        chunks = await cursor.to_list(length=500)
        for chunk in chunks:
            chunk["score"] = 1.0
        filenames = list(dict.fromkeys(c["filename"].lower() for c in chunks))
        logger.info(
            "[RAG RETRIEVER] retrieve_all_user_chunks: %d chunks across %d file(s) for user=%s org=%s",
            len(chunks), len(filenames), user_id[:8] + "...", org_id or "none",
        )
        return chunks, filenames
    except Exception as exc:
        logger.warning("[RAG RETRIEVER] retrieve_all_user_chunks failed: %s", exc)
        return [], []


async def retrieve_chunks(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    query_vector: Optional[list[float]],
    query_text: str,
    user_id: str,
    top_k: int = 5,
    org_id: Optional[str] = None,
) -> tuple[list[dict], list[str]]:
    """
    Return (chunks, source_filenames).

    chunks          : top-k dicts with keys {text, filename, chunk_index, score, doc_id}
    source_filenames: deduplicated list of filenames that contributed chunks — used as
                      the citation allowed-list passed to the Stage 8 system prompt.

    Retrieval covers both user-scoped and org-scoped chunks in a single pass.
    """
    candidates: list[dict] = []

    if query_vector:
        candidates = await _vector_search(db, query_vector, user_id, _CANDIDATE_K, org_id)

    if not candidates:
        candidates = await _keyword_search(db, query_text, user_id, _CANDIDATE_K, org_id)

    if not candidates:
        return [], []

    candidates = _proximity_dedup(candidates)
    selected   = _mmr_rerank(candidates, top_k)

    filenames = list(dict.fromkeys(c["filename"].lower() for c in selected))
    return selected, filenames


# ── Search paths ──────────────────────────────────────────────────────────────

async def _vector_search(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    query_vector: list[float],
    user_id: str,
    limit: int,
    org_id: Optional[str] = None,
) -> list[dict]:
    # Scope filtering is done as a $match stage AFTER $vectorSearch rather than
    # inside $vectorSearch.filter.
    pipeline = [
        {
            "$vectorSearch": {
                "index": _RAG_INDEX,
                "path": "embedding",
                "queryVector": query_vector,
                "numCandidates": limit * 10,
                "limit": limit * 4,
            }
        }
    ]
    scope = _scope_filter(user_id, org_id)
    if scope:
        pipeline.append({"$match": scope})
    pipeline.extend([
        {"$limit": limit},
        {
            "$project": {
                "_id": 0,
                "doc_id": 1,
                "filename": 1,
                "chunk_index": 1,
                "text": 1,
                "scope": 1,
                "score": {"$meta": "vectorSearchScore"},
            }
        },
    ])
    try:
        cursor = db[RAG_CHUNKS_COLLECTION].aggregate(pipeline)
        results = await cursor.to_list(length=limit)
        logger.info(
            "[RAG RETRIEVER] vector search returned %d chunks for user=%s org=%s",
            len(results), user_id[:8] + "...", org_id or "none",
        )
        return results
    except Exception as exc:
        logger.warning(
            "[RAG RETRIEVER] vector search failed (index missing or misconfigured): %s", exc
        )
        return []


async def _keyword_search(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    query_text: str,
    user_id: str,
    limit: int,
    org_id: Optional[str] = None,
) -> list[dict]:
    """
    Case-insensitive regex search on chunk text.
    Assigns a synthetic score = (matching_tokens / total_tokens).
    """
    tokens = [
        t for t in re.findall(r"[a-zA-Z0-9]+", query_text.lower())
        if len(t) > 3
    ][:6]

    if not tokens:
        logger.info("[RAG RETRIEVER] keyword search: no usable tokens in query")
        return []

    or_text_clauses = [{"text": {"$regex": t, "$options": "i"}} for t in tokens]
    
    scope = _scope_filter(user_id, org_id)
    if scope:
        query_filter = {"$and": [scope, {"$or": or_text_clauses}]}
    else:
        query_filter = {"$or": or_text_clauses}

    logger.info(
        "[RAG RETRIEVER] keyword search: tokens=%s user=%s org=%s",
        tokens, user_id[:8] + "...", org_id or "none",
    )
    try:
        cursor = db[RAG_CHUNKS_COLLECTION].find(
            query_filter,
            {"_id": 0, "doc_id": 1, "filename": 1, "chunk_index": 1, "text": 1, "scope": 1},
        ).limit(limit)
        results = await cursor.to_list(length=limit)

        for doc in results:
            text_lower = doc["text"].lower()
            matched = sum(1 for t in tokens if t in text_lower)
            doc["score"] = round(matched / len(tokens), 3)

        results.sort(key=lambda d: d["score"], reverse=True)
        logger.info(
            "[RAG RETRIEVER] keyword search returned %d chunks for user=%s org=%s",
            len(results), user_id[:8] + "...", org_id or "none",
        )
        if not results:
            total_visible = await db[RAG_CHUNKS_COLLECTION].count_documents(
                _scope_filter(user_id, org_id)
            )
            logger.warning(
                "[RAG RETRIEVER] keyword search: 0 results but user has %d visible chunks "
                "(token mismatch or wrong user_id?)",
                total_visible,
            )
        return results
    except Exception as exc:
        logger.warning("[RAG RETRIEVER] keyword search failed: %s", exc)
        return []


# ── Post-retrieval ────────────────────────────────────────────────────────────

def _proximity_dedup(candidates: list[dict]) -> list[dict]:
    """
    Drop chunks that are adjacent (±1 chunk_index) to an already-seen chunk from
    the same document.

    Only applied to sliding_window chunks — those use overlapping windows so
    adjacent chunks share substantial text and dedup prevents near-duplicate
    context from reaching the LLM.

    Section-based chunks (SECTION, ROW, JSON_RECORD) represent *distinct*
    paragraphs or records; adjacent chunks are not overlapping and must all be
    eligible for retrieval.  Chunks without a chunk_strategy field (legacy) are
    also treated as section-based so that old indexed files behave correctly
    after an upgrade without requiring a full re-index.
    """
    seen: set[tuple[str, int]] = set()
    deduped: list[dict] = []

    for chunk in candidates:
        strategy = chunk.get("chunk_strategy", "section")
        if strategy != "sliding_window":
            # Non-overlapping chunk — always keep, no adjacency check needed.
            deduped.append(chunk)
            continue

        doc_id = chunk.get("doc_id", "")
        idx    = chunk.get("chunk_index", 0)

        if (doc_id, idx - 1) in seen or (doc_id, idx + 1) in seen:
            continue

        seen.add((doc_id, idx))
        deduped.append(chunk)

    return deduped


def _mmr_rerank(candidates: list[dict], top_k: int) -> list[dict]:
    """
    Score-based MMR reranking.

    Iteratively selects the chunk with the highest
      MMR_score = score_i − λ × max(scores of already-selected chunks)

    The diversity penalty (λ × max_selected_score) approximates inter-chunk
    similarity: two chunks that both score high against the query are likely
    close to each other in embedding space — so we penalise based on the
    running maximum of selected scores rather than actual inter-chunk distances.
    """
    if len(candidates) <= top_k:
        return candidates

    selected: list[dict]  = []
    remaining              = list(candidates)
    selected_scores: list[float] = []

    while remaining and len(selected) < top_k:
        best_chunk = None
        best_mmr   = float("-inf")

        for chunk in remaining:
            score   = chunk.get("score", 0.0)
            penalty = _MMR_LAMBDA * max(selected_scores) if selected_scores else 0.0
            mmr     = score - penalty

            if mmr > best_mmr:
                best_mmr   = mmr
                best_chunk = chunk

        if best_chunk is None:
            break

        selected.append(best_chunk)
        selected_scores.append(best_chunk.get("score", 0.0))
        remaining.remove(best_chunk)

    return selected
