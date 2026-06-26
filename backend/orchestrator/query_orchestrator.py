"""
Query Orchestrator — the central AI pipeline (10 stages).

Pipeline
--------
  0. Reference resolution    — zero LLM; substitutes "same plant" with actual entity
  1. Query normalization     — 1 LLM call; extracts metrics/filters/time_range/grouping
  2. Intent classification   — 1 LLM call (or fast-path regex); routes to 8 paths
  3. Collection selection    — LLM + heuristic hybrid
  4. Semantic keyword build  — base keywords + LLM synonyms
  5. Data fetch              — vector search (if configured) OR keyword search
  6. Retrieval validation    — confidence scoring; routes to proceed / low_confidence / no_data
  7. Context build           — serialises fetched data to text for LLM
  8. LLM narration           — stream or complete with data context + intent suffix
  9. Post-response           — session context update + follow-up generation

Intent routing
--------------
conversational      → LLM directly, skip DB entirely
domain_knowledge    → LLM directly, skip DB entirely
workflow_automation → LLM directly, skip DB entirely
analytics           → DB fetch, analytics system prompt suffix
comparison          → DB fetch, comparison system prompt suffix
summary             → DB fetch, larger limit, executive summary suffix
forecasting         → DB fetch, forecasting system prompt suffix
data_query          → DB fetch, standard pipeline

── ZOHO CRM RE-ACTIVATION ────────────────────────────────────────────────────
Search for "# ── ZOHO CRM ──" to find the three blocks to uncomment.
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import AsyncGenerator, Optional

from database.mongodb import get_db
from llm.client import LLMClient, get_llm_client
from orchestrator.analytics_executor import run_analytics
from orchestrator.collection_selector import select_collections
from orchestrator.context_builder import build_analytics_context, build_context, build_merged_context, build_rag_context, build_rag_only_context
from orchestrator.source_selector import compute_rag_confidence, select_context_source
from orchestrator.followup_engine import generate_followups
from orchestrator.intent_classifier import classify_intent
from orchestrator.query_normalizer import QueryMeta, normalize_query
from orchestrator.reference_resolver import is_followup_query, resolve_references
from orchestrator.response_composer import StructuredResponse, compose
from prompts.builder import PromptContext, build_system_prompt as _build_prompt
from orchestrator.retrieval_validator import ValidationResult, validate_retrieval
from orchestrator.semantic_expander import build_search_terms, get_query_embedding
from orchestrator.session_context import (
    AnalyticalContext,
    SessionContextStore,
    extract_time_range,
    get_context_store,
)
from repositories.generic_repository import GenericRepository
from services.response_cache import DbResultCache, get_db_cache

logger = logging.getLogger("voxa.orchestrator")

# ── ZOHO CRM ── Block 1 of 3: import (uncomment to activate) ─────────────────
# from services.zoho_crm_service import get_crm_service
# ─────────────────────────────────────────────────────────────────────────────

FETCH_TIMEOUT_SECONDS = 120.0
MAX_KEYWORDS = 5

# Cap for the fallback full-scan path only (vector/keyword searches are uncapped
# because their filter already scopes the result set to relevant documents).
_FALLBACK_SCAN_LIMIT = 2_000

# Maximum records sent to the LLM context per collection after filtering.
# All matching records are fetched from MongoDB (for accurate counts), but only
# this many are serialised into the prompt so the JSON is never cut off mid-record.
_CONTEXT_SAMPLE_LIMIT = 300
from config.settings import RAG_TOP_K, RAG_CONFIDENCE_THRESHOLD

# Page size for data_query retrieval
DATA_QUERY_PAGE_SIZE = 50
# Sample size for summary/forecasting (no pagination)
SAMPLE_SIZE = 100

_EMBEDDING_FIELD = os.getenv("EMBEDDING_FIELD", "embedding")
_EMBEDDING_INDEX = os.getenv("EMBEDDING_INDEX", "vector_index")

# ── Stop-word set ─────────────────────────────────────────────────────────────
_KEYWORD_STOP_WORDS = {
    "the", "a", "an", "of", "in", "on", "at", "by", "for", "with",
    "and", "or", "not", "to", "from", "into", "about", "over", "after",
    "before", "above", "below", "around", "through", "under", "since",
    "both", "between", "such", "than", "then", "also", "only",
    "is", "are", "was", "were", "be", "been", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may",
    "might", "shall", "must", "can",
    "i", "me", "my", "we", "us", "our", "you", "your", "they",
    "them", "their", "it", "its", "he", "she", "him", "her",
    "that", "this", "these", "those", "who", "whom", "which",
    "what", "how", "when", "where", "why",
    "show", "give", "tell", "find", "list", "get", "make", "take",
    "come", "see", "know", "like", "just", "need", "want", "help",
    "use", "back", "here", "there", "well", "still", "very", "good",
    "great", "per", "each", "many", "much", "more", "most", "any",
    "some", "all", "few",
    "hello", "hi", "hey", "howdy", "greetings", "hear", "heard",
    "thanks", "thank", "please", "okay", "sure", "yes", "yeah",
    "alright", "ok", "got", "understood", "fine", "bye", "goodbye",
}


def _extract_keywords(query: str) -> list[str]:
    tokens = query.lower().replace("?", "").replace(",", "").replace("!", "").split()
    return [t for t in tokens if t not in _KEYWORD_STOP_WORDS and len(t) > 2][:MAX_KEYWORDS]


# ── Per-intent system prompt suffixes ────────────────────────────────────────

_NO_DATA_RESPONSE = (
    "I searched the database but couldn't find any relevant records for your query. "
    "Please try rephrasing, check if the relevant data exists in the system, "
    "or contact your administrator if you believe the data should be present."
)

# ── Boolean adjective labels for direct count response ────────────────────────
_BOOL_TRUE_LABELS: dict[str, str] = {
    "active": "active", "enabled": "enabled", "open": "open",
}
_BOOL_FALSE_LABELS: dict[str, str] = {
    "active": "inactive", "enabled": "disabled", "open": "closed",
}


def _natural_filter_text(filter_dict: dict) -> str:
    """Convert a resolved MongoDB filter to a short natural-language qualifier."""
    if not filter_dict:
        return ""
    parts: list[str] = []
    for field, value in filter_dict.items():
        if isinstance(value, bool) and field.startswith("is_"):
            adj = field[3:]
            label = (_BOOL_TRUE_LABELS if value else _BOOL_FALSE_LABELS).get(adj, adj if value else f"not {adj}")
            parts.append(label)
        elif isinstance(value, dict) and "$regex" in value:
            # strip anchors and escape sequences to get the raw keyword
            raw = value["$regex"].lstrip("\\^").rstrip("\\$")
            parts.append(raw.lower())
        elif isinstance(value, str):
            parts.append(value.lower())
    return " ".join(parts)


def _try_direct_count_response(
    analytics_results: dict,
    query_meta=None,
) -> Optional[str]:
    """
    For simple filtered-count analytics (single number, applied filter, no group_by),
    return a fully-formed answer string, bypassing LLM narration entirely.
    Returns None when the query is too complex for direct generation (has top_records,
    group_by, or multiple aggregated metrics that need prose explanation).
    """
    # Find collections where a real filter was applied and the result is just a count.
    # Skip collections with top_records/bottom_records — those need LLM narration to
    # present the actual record names meaningfully.
    filtered = [
        (coll, data)
        for coll, data in analytics_results.items()
        if "count" in data
        and data.get("filter")
        and "group_by" not in data
        and "top_records" not in data
        and "bottom_records" not in data
    ]
    if not filtered:
        return None
    if len(filtered) == 1:
        coll, data = filtered[0]
    else:
        # Multiple filtered collections — pick the one whose name matches the query
        import re as _re_mod
        entities = [e.lower().replace(" ", "_") for e in (query_meta.entities if query_meta else [])]
        raw_terms = set(_re_mod.findall(r"[a-z]+", (query_meta.raw_query or "").lower())) if query_meta else set()
        best = None
        for coll, data in filtered:
            coll_stem = coll.removeprefix("main.")
            # Match by entity list first, then by raw query keywords
            if any(ent in coll_stem or coll_stem in ent for ent in entities):
                best = (coll, data)
                break
            if any(term in coll_stem for term in raw_terms if len(term) > 3):
                best = (coll, data)
        if best is None:
            # Last resort: pick the first filtered collection
            best = filtered[0]
            logger.info("[DIRECT_COUNT] no entity match, using first filtered collection: %s", best[0])
        coll, data = best

    count: int = data["count"]
    total_count: int = data.get("total_count", 0)
    filter_text = _natural_filter_text(data["filter"])

    # Human-readable collection label (strip "main." ingestion prefix)
    coll_label = coll.removeprefix("main.").replace("_", " ")

    if count == 0:
        qualifier = f"{filter_text} " if filter_text else ""
        return f"There are no {qualifier}{coll_label} matching that criteria."

    qualifier = f"{filter_text} " if filter_text else ""
    if total_count and total_count != count:
        return f"There are {count:,} {qualifier}{coll_label} out of {total_count:,} total."
    return f"There are {count:,} {qualifier}{coll_label}."

import prompts.intents as _intents
_NO_DATA_SYSTEM = _intents.NO_DATA

_COMPARISON_SUFFIX = (
    "\n\nNote: This is a COMPARISON query. Highlight differences, deltas, and "
    "percentage changes. Use a table when multiple rows are compared."
)

_SUMMARY_SUFFIX = (
    "\n\nNote: This is a SUMMARY / DASHBOARD query. Provide a broad executive-style "
    "overview covering the most important metrics. Use headers and bullet points."
)

_ANALYTICS_SUFFIX = (
    "\n\nNote: This is an ANALYTICS query. The data context contains EXACT database-computed "
    "values. Report them precisely. Do not hedge or estimate — these are exact figures.\n"
    "If the filter requested (e.g. 'active', 'critical') could not be applied and the count "
    "reflects all records, state the total and note that the filter was not applied rather "
    "than saying you lack data."
)

_FORECASTING_SUFFIX = (
    "\n\nNote: This is a FORECASTING query. Use available trend data to inform projections. "
    "Clearly state any assumptions and confidence caveats. Do not invent future values "
    "not supported by the data."
)



def _build_exact_filter(filters: dict, fields: list[str]) -> dict:
    """
    Convert query_meta.filters into a MongoDB AND filter.
    Resolves filter keys to actual field names.
    - Boolean adjectives ("active" / "inactive") resolve to is_<adjective> boolean fields.
    - ID-like fields use exact-match regex; other strings use partial (contains) match
      so "maintenance" finds "UNDER_MAINTENANCE".
    """
    import re as _re
    from orchestrator.analytics_executor import (
        _resolve_field, _coerce_value, _ACTIVE_ADJECTIVES, _NEGATIVE_TO_POSITIVE,
    )
    fields_lower = {f.lower(): f for f in fields}
    resolved: dict = {}
    for key, value in filters.items():
        # Boolean adjective → is_<value> field; negative → try positive field with False
        if isinstance(value, str) and value.lower() in _ACTIVE_ADJECTIVES:
            bool_field_name = f"is_{value.lower()}"
            if bool_field_name in fields_lower:
                resolved[fields_lower[bool_field_name]] = _ACTIVE_ADJECTIVES[value.lower()]
                continue
            positive = _NEGATIVE_TO_POSITIVE.get(value.lower())
            if positive:
                pos_field = f"is_{positive}"
                if pos_field in fields_lower:
                    resolved[fields_lower[pos_field]] = False
                    continue

        field = _resolve_field(key, fields)
        if not field:
            logger.warning(
                "[FILTER] key %r not found in collection fields — filter dropped silently", key
            )
            continue
        coerced = _coerce_value(value)
        if isinstance(coerced, str):
            if any(field.lower().endswith(s) for s in ("_id", "_number", "_code")):
                resolved[field] = {"$regex": f"^{_re.escape(coerced)}$", "$options": "i"}
            else:
                resolved[field] = {"$regex": _re.escape(coerced), "$options": "i"}
        else:
            resolved[field] = coerced
    return resolved


def _find_date_field(fields: list) -> Optional[str]:
    """
    Detect the primary date field from a collection's field list.
    Checks known names in priority order, then falls back to any field containing 'date'.
    """
    _PRIORITY = [
        "record_date", "date", "appointment_date", "operation_date",
        "inspection_date", "billing_date", "scheduled_date", "discharge_date",
        "admit_date", "created_at", "updated_at", "timestamp",
    ]
    fields_lower = {f.lower(): f for f in fields}
    for name in _PRIORITY:
        if name in fields_lower:
            return fields_lower[name]
    for f in fields:
        if "date" in f.lower():
            return f
    return None


def _resolve_time_range_to_filter(time_range: str, date_field: str) -> dict:
    """
    Convert a natural-language time_range string into a MongoDB date range filter.
    Uses datetime.today() as the live reference — no hardcoded dates.
    Supports: next/last N days/weeks/months/years, this/last week/month/year,
              today, yesterday, Q1-Q4 YYYY, month-name YYYY, plain year, specific dates.
    """
    import calendar as _cal
    from datetime import date, timedelta
    import re as _re

    today = date.today()
    tr = time_range.lower().strip()

    # next N days/weeks/months/years
    m = _re.match(r"next\s+(\d+)\s+(day|week|month|year)s?", tr)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        start = today + timedelta(days=1)
        if unit == "day":
            end = today + timedelta(days=n)
        elif unit == "week":
            end = today + timedelta(weeks=n)
        elif unit == "month":
            end = today + timedelta(days=n * 30)
        else:
            end = today + timedelta(days=n * 365)
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # last/past N days/weeks/months/years
    m = _re.match(r"(?:last|past)\s+(\d+)\s+(day|week|month|year)s?", tr)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        end = today
        if unit == "day":
            start = today - timedelta(days=n)
        elif unit == "week":
            start = today - timedelta(weeks=n)
        elif unit == "month":
            start = today - timedelta(days=n * 30)
        else:
            start = today - timedelta(days=n * 365)
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # today / yesterday
    if tr == "today":
        return {date_field: {"$gte": str(today), "$lte": str(today)}}
    if tr == "yesterday":
        yd = today - timedelta(days=1)
        return {date_field: {"$gte": str(yd), "$lte": str(yd)}}

    # this week (Mon–Sun)
    if tr == "this week":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # last week / previous week
    if tr in ("last week", "previous week"):
        start = today - timedelta(days=today.weekday() + 7)
        end = start + timedelta(days=6)
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # next week
    if tr == "next week":
        start = today + timedelta(days=7 - today.weekday())
        end = start + timedelta(days=6)
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # this month
    if tr == "this month":
        start = today.replace(day=1)
        end = today.replace(day=_cal.monthrange(today.year, today.month)[1])
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # last month / previous month
    if tr in ("last month", "previous month"):
        first_this = today.replace(day=1)
        end = first_this - timedelta(days=1)
        start = end.replace(day=1)
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # next month
    if tr == "next month":
        if today.month == 12:
            start = today.replace(year=today.year + 1, month=1, day=1)
        else:
            start = today.replace(month=today.month + 1, day=1)
        end = start.replace(day=_cal.monthrange(start.year, start.month)[1])
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # this quarter
    if tr == "this quarter":
        q = (today.month - 1) // 3
        q_start_month = q * 3 + 1
        q_end_month = q_start_month + 2
        start = today.replace(month=q_start_month, day=1)
        end = today.replace(month=q_end_month, day=_cal.monthrange(today.year, q_end_month)[1])
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # this year
    if tr == "this year":
        return {date_field: {"$gte": f"{today.year}-01-01", "$lte": f"{today.year}-12-31"}}

    # last year / previous year
    if tr in ("last year", "previous year"):
        y = today.year - 1
        return {date_field: {"$gte": f"{y}-01-01", "$lte": f"{y}-12-31"}}

    # next year
    if tr == "next year":
        y = today.year + 1
        return {date_field: {"$gte": f"{y}-01-01", "$lte": f"{y}-12-31"}}

    # Q1-Q4 YYYY (e.g. "Q2 2026")
    m = _re.match(r"q([1-4])\s*(\d{4})", tr)
    if m:
        q, year = int(m.group(1)), int(m.group(2))
        q_start_month = (q - 1) * 3 + 1
        q_end_month = q * 3
        start = date(year, q_start_month, 1)
        end = date(year, q_end_month, _cal.monthrange(year, q_end_month)[1])
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # Month name + optional year (e.g. "june 2026", "january")
    _MONTHS = {
        "january": 1, "february": 2, "march": 3, "april": 4,
        "may": 5, "june": 6, "july": 7, "august": 8,
        "september": 9, "october": 10, "november": 11, "december": 12,
    }
    m = _re.match(r"(" + "|".join(_MONTHS) + r")(?:\s+(\d{4}))?", tr)
    if m:
        month_num = _MONTHS[m.group(1)]
        year = int(m.group(2)) if m.group(2) else today.year
        start = date(year, month_num, 1)
        end = date(year, month_num, _cal.monthrange(year, month_num)[1])
        return {date_field: {"$gte": str(start), "$lte": str(end)}}

    # Plain year (e.g. "2026")
    m = _re.match(r"^((?:19|20)\d{2})$", tr)
    if m:
        year = int(m.group(1))
        return {date_field: {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"}}

    # Specific date: DD/MM/YYYY or MM/DD/YYYY (a > 12 forces day-first)
    m = _re.match(r"(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?", tr)
    if m:
        try:
            a, b = int(m.group(1)), int(m.group(2))
            year = int(m.group(3)) if m.group(3) else today.year
            if year < 100:
                year += 2000
            d = date(year, b, a) if a > 12 else date(year, a, b)
            return {date_field: {"$gte": str(d), "$lte": str(d)}}
        except ValueError:
            pass

    logger.debug("[TIME_FILTER] unrecognised time_range %r — no date filter applied", time_range)
    return {}


class QueryOrchestrator:
    """
    Stateful orchestrator — initialised once at startup, reused per request.
    Implements a 10-stage pipeline covering reference resolution through
    post-response context updates.
    """

    def __init__(
        self,
        repository: Optional[GenericRepository] = None,
        llm: Optional[LLMClient] = None,
    ) -> None:
        self._repo = repository
        self._llm = llm or get_llm_client()
        self._metadata: dict = {}
        self._ctx_store: SessionContextStore = get_context_store()
        # Persists per-session metadata from the most recent stream() call so
        # the router can attach intent / source / confidence to the done frame.
        self._last_stream_meta: dict[str, dict] = {}

    def get_last_stream_meta(self, session_id: str) -> dict:
        """Return metadata stored from the last stream() call for this session."""
        return self._last_stream_meta.get(session_id, {})

    # ── Initialisation ────────────────────────────────────────────────────────

    async def initialise(self) -> None:
        db = get_db()
        if db is None:
            logger.warning("MongoDB not connected — orchestrator running without database")
            return
        self._repo = GenericRepository(db)
        await self._refresh_metadata()
        logger.info("QueryOrchestrator ready: %d collections discovered", len(self._metadata))

    async def _refresh_metadata(self) -> None:
        if self._repo is None:
            return
        try:
            self._metadata = await self._repo.get_collection_metadata()
        except Exception as exc:
            logger.error("Metadata refresh failed: %s", exc)

    async def _ensure_ready(self) -> None:
        if self._repo is None:
            db = get_db()
            if db is not None:
                self._repo = GenericRepository(db)
                logger.info("[ORCHESTRATOR] repository attached lazily")
            else:
                logger.warning("[ORCHESTRATOR] database unavailable during request")
        if not self._metadata and self._repo is not None:
            await self._refresh_metadata()

    # ── Public API ────────────────────────────────────────────────────────────

    async def process(
        self,
        query: str,
        session_id: str = "",
        conversation_history: Optional[list[dict]] = None,
        page: int = 1,
        user_id: str = "",
        org_id: str = "",
        dashboard_context: str = "",
    ) -> StructuredResponse:
        """Non-streaming pipeline. Returns a fully-populated StructuredResponse."""
        pipeline_start = time.perf_counter()
        await self._ensure_ready()

        if not query or not query.strip():
            return compose(
                "I didn't receive a question. What would you like to know about your data?",
                [], 0,
                confidence=1.0, source="llm", intent="conversational",
                followups=["What data do you have?", "Show me a summary of our operations"],
                metadata={},
            )

        timings: dict[str, float] = {}

        # Stage 0: reference resolution — resolve anaphoric references from session context.
        # Only applied to genuine follow-ups; standalone questions reset the topic
        # context so stale entities/time ranges never leak into them.
        t0 = time.perf_counter()
        _sess_ctx = self._ctx_store.get(session_id) if session_id else AnalyticalContext()
        if is_followup_query(query, _sess_ctx):
            resolved_query = resolve_references(query, _sess_ctx)
        else:
            if session_id:
                self._ctx_store.reset_topic(session_id)
            resolved_query = query
        effective_history = conversation_history or []
        timings["reference_resolution_ms"] = _ms(t0)
        # ── Stage 1: Query normalization ──────────────────────────────────────
        t1 = time.perf_counter()
        query_meta = await normalize_query(resolved_query, self._llm)
        timings["query_normalization_ms"] = _ms(t1)
        logger.info(
            "[STAGE 1] normalized: metrics=%s filters=%s time=%s",
            query_meta.metrics, query_meta.filters, query_meta.time_range,
        )

        # ── Stage 2: Intent classification ────────────────────────────────────
        t2 = time.perf_counter()
        intent = await classify_intent(resolved_query, self._llm)
        timings["intent_classification_ms"] = _ms(t2)
        logger.info(
            "[STAGE 2] intent=%s session=%s elapsed_ms=%.0f",
            intent, session_id, timings["intent_classification_ms"],
        )

        # ── Fast paths (no DB) ────────────────────────────────────────────────
        if intent in ("conversational", "domain_knowledge", "workflow_automation"):
            # Always attempt RAG before the fast path — the user may have uploaded
            # documents that answer this question directly.
            _fp_vector = await get_query_embedding(resolved_query) if user_id else None
            rag_chunks_fp, source_filenames_fp = await self._fetch_rag_chunks(
                resolved_query, _fp_vector, user_id, RAG_TOP_K, org_id=org_id
            )
            if rag_chunks_fp:
                rag_text = build_rag_context(rag_chunks_fp)
                system = (
                    "You are VOXA, an AI Assistant. The user has uploaded knowledge documents "
                    "that are relevant to this question.\n\n"
                    "--- KNOWLEDGE BASE ---\n"
                    f"{rag_text}\n"
                    "--- END KNOWLEDGE BASE ---\n\n"
                    "Answer the user's question based on the knowledge base above. "
                    "If the answer is not present in the documents, say so clearly."
                )
            elif dashboard_context in _intents.SCOPED_FAST_PATH:
                _fp = _intents.SCOPED_FAST_PATH[dashboard_context]
                system = _fp.get(intent, _fp.get("conversational", _intents.FAST_PATH[intent]))
            else:
                system = _intents.FAST_PATH[intent]
            msgs = [{"role": "system", "content": system}]
            if effective_history:
                msgs.extend(effective_history[-8:])
            msgs.append({"role": "user", "content": resolved_query})
            try:
                response_text = self._llm.complete(msgs)
            except Exception as exc:
                logger.error("LLM call failed (conversational): %s", exc)
                response_text = "Hello! I'm VOXA. How can I help you with your data today?"

            followups: list[str] = []
            if intent not in ("conversational",):
                followups = await generate_followups(
                    query=query,
                    response_snippet=response_text,
                    collections_used=[],
                    llm=self._llm,
                )

            source = "rag_document" if rag_chunks_fp else "llm"
            self._update_context(session_id, query, response_text, intent, [], None)
            elapsed = _ms(pipeline_start)
            logger.info(
                "[ORCHESTRATOR] done intent=%s source=%s elapsed_ms=%.0f",
                intent, source, elapsed,
            )
            return compose(
                response_text, [], int(elapsed),
                confidence=1.0, source=source, intent=intent,
                followups=followups,
                metadata={**timings, "intent": intent},
            )

        # ── Fast paths (no DB) ────────────────────────────────────────────────
        #── Stages 3-9: DB pipeline ────────────────────────────────────────────
        result = await self._db_pipeline(
            resolved_query, query_meta, intent, [], session_id, timings, page,
            user_id=user_id, org_id=org_id, dashboard_context=dashboard_context,
        )

        self._update_context(
            session_id, query, result.response, intent,
            result.collections_used, query_meta,
        )
        elapsed = _ms(pipeline_start)
        logger.info(
            "[ORCHESTRATOR] done intent=%s source=%s confidence=%.2f "
            "collections=%s elapsed_ms=%.0f",
            intent, result.source, result.confidence,
            result.collections_used, elapsed,
        )
        result.metadata.update(timings)
        result.metadata["intent"] = intent
        result.latency_ms = int(elapsed)
        return result

    async def stream(
        self,
        query: str,
        session_id: str = "",
        conversation_history: Optional[list[dict]] = None,
        page: int = 1,
        user_id: str = "",
        org_id: str = "",
        dashboard_context: str = "",
    ) -> AsyncGenerator[str, None]:
        """Streaming pipeline — yields LLM tokens as they arrive."""
        await self._ensure_ready()

        if not query or not query.strip():
            yield "I didn't receive a question. What would you like to know about your data?"
            return

        # Stage 0: reference resolution — follow-ups only; standalone queries
        # reset the topic context (see process() for rationale)
        pipeline_start = time.perf_counter()
        _sess_ctx = self._ctx_store.get(session_id) if session_id else AnalyticalContext()
        if is_followup_query(query, _sess_ctx):
            resolved_query = resolve_references(query, _sess_ctx)
        else:
            if session_id:
                self._ctx_store.reset_topic(session_id)
            resolved_query = query
        effective_history = conversation_history or []

        # Stage 1: Query normalization (run with intent classification in parallel)
        t12 = time.perf_counter()
        query_meta, intent = await asyncio.gather(
            normalize_query(resolved_query, self._llm),
            classify_intent(resolved_query, self._llm),
        )
        logger.info(
            "[STAGE 1-2][STREAM] normalize+intent_ms=%.0f intent=%s metrics=%s",
            _ms(t12), intent, query_meta.metrics,
        )

        # Fast paths
        if intent in ("conversational", "domain_knowledge", "workflow_automation"):
            # Always check RAG before taking the fast path — the user may have
            # uploaded documents that answer this question directly.
            _fp_vector = await get_query_embedding(resolved_query) if user_id else None
            rag_chunks_fp, source_filenames_fp = await self._fetch_rag_chunks(
                resolved_query, _fp_vector, user_id, RAG_TOP_K, org_id=org_id
            )
            if rag_chunks_fp:
                rag_text = build_rag_context(rag_chunks_fp)
                system = (
                    "You are VOXA, an AI Assistant. The user has uploaded knowledge documents "
                    "that are relevant to this question.\n\n"
                    "--- KNOWLEDGE BASE ---\n"
                    f"{rag_text}\n"
                    "--- END KNOWLEDGE BASE ---\n\n"
                    "Answer the user's question based on the knowledge base above. "
                    "If the answer is not present in the documents, say so clearly."
                )
            elif dashboard_context in _intents.SCOPED_FAST_PATH:
                _fp = _intents.SCOPED_FAST_PATH[dashboard_context]
                system = _fp.get(intent, _fp.get("conversational", _intents.FAST_PATH[intent]))
            else:
                system = _intents.FAST_PATH[intent]
            msgs = [{"role": "system", "content": system}]
            if effective_history:
                msgs.extend(effective_history[-8:])
            msgs.append({"role": "user", "content": resolved_query})
            full: list[str] = []
            async for token in self._llm.stream(msgs):
                yield token
                full.append(token)
            response_text_fp = "".join(full)
            source_fp = "rag_document" if rag_chunks_fp else "llm"
            self._update_context(session_id, query, response_text_fp, intent, [], None)
            self._last_stream_meta[session_id] = {
                "intent": intent,
                "source": source_fp,
                "confidence": 1.0,
                "collections_used": [],
                "routing": "fast_path_rag" if rag_chunks_fp else "fast_path",
                "citations": self._extract_citations(response_text_fp, source_filenames_fp) if rag_chunks_fp else [],
            }
            logger.info(
                "[ORCHESTRATOR][STREAM] done intent=%s source=%s elapsed_ms=%.0f",
                intent, source_fp, _ms(pipeline_start),
            )
            return

        # Stage 3: Collection selection
        t3 = time.perf_counter()
        selected = await select_collections(resolved_query, self._metadata, self._llm)
        if dashboard_context in _intents.SCOPED_COLLECTION:
            selected = [_intents.SCOPED_COLLECTION[dashboard_context]]
        logger.info("[STAGE 3][STREAM] selected=%s sel_ms=%.0f", selected, _ms(t3))

        # Stage 4: Semantic keyword build
        t4 = time.perf_counter()
        base_kw = _extract_keywords(resolved_query)
        meta_hints = query_meta.search_hints()
        combined_base = list(dict.fromkeys(base_kw + meta_hints))
        expanded_kw, query_vector = await asyncio.gather(
            build_search_terms(resolved_query, combined_base, self._llm),
            get_query_embedding(resolved_query),
        )
        logger.info(
            "[STAGE 4][STREAM] expand_ms=%.0f base=%s expanded=%s vector=%s",
            _ms(t4), combined_base, expanded_kw, "yes" if query_vector else "no",
        )

        # Stage 5b: RAG retrieval — fired now, runs in parallel with Stage 5a below
        rag_task = asyncio.ensure_future(
            self._fetch_rag_chunks(resolved_query, query_vector, user_id, RAG_TOP_K, org_id=org_id)
        )

        # Stage 5: Route by intent
        if intent in ("analytics", "comparison"):
            # Analytics path: DB aggregation + optional sample records + LLM narration
            t5 = time.perf_counter()
            _cache = get_db_cache()
            _cache_key = None if user_id else _cache.make_key(intent, selected, query_meta)
            _cached = _cache.get(_cache_key) if _cache_key else None
            if _cached:
                analytics_results = _cached["analytics_results"]
                sample_fetched = _cached["sample_fetched"]
                rag_chunks, source_filenames = await rag_task
                logger.info("[CACHE][STREAM] hit intent=%s key=%s", intent, _cache_key)
            else:
                analytics_results, sample_fetched, (rag_chunks, source_filenames) = await asyncio.gather(
                    run_analytics(query_meta, selected, self._metadata, self._repo, top_n=query_meta.top_n),
                    self._fetch_sample(resolved_query, selected, expanded_kw, query_vector, query_meta),
                    rag_task,
                )
                if _cache_key and analytics_results:
                    _cache.set(_cache_key, {"analytics_results": analytics_results, "sample_fetched": sample_fetched})
            logger.info("[STAGE 5][STREAM][ANALYTICS] analytics_ms=%.0f", _ms(t5))

            if not analytics_results or all(not v for v in analytics_results.values()):
                _rag_conf = compute_rag_confidence(rag_chunks)
                _rag_relevant = rag_chunks and _rag_conf >= RAG_CONFIDENCE_THRESHOLD
                if _rag_relevant:
                    rag_text = build_rag_context(rag_chunks)
                    _nd_system = (
                        "You are VOXA, an AI Assistant. No database records were found for this query, "
                        "but the user has uploaded knowledge documents that may contain the answer.\n\n"
                        "--- KNOWLEDGE BASE ---\n"
                        f"{rag_text}\n"
                        "--- END KNOWLEDGE BASE ---\n\n"
                        "Answer the user's question based on the knowledge base above. "
                        "If the answer is not present, say so clearly."
                    )
                    _nd_source = "rag_document"
                else:
                    _nd_system = _NO_DATA_SYSTEM
                    _nd_source = "none"
                msgs = [{"role": "system", "content": _nd_system}]
                if effective_history:
                    msgs.extend(effective_history[-8:])
                msgs.append({"role": "user", "content": resolved_query})
                full = []
                async for token in self._llm.stream(msgs):
                    yield token
                    full.append(token)
                _nd_text = "".join(full)
                self._update_context(session_id, query, _nd_text, intent, [], None)
                self._last_stream_meta[session_id] = {
                    "intent": intent, "source": _nd_source,
                    "confidence": _rag_conf if _rag_relevant else 0.0,
                    "collections_used": [],
                    "routing": "rag_fallback" if _rag_relevant else "no_data_fallback",
                    "citations": self._extract_citations(_nd_text, source_filenames) if _rag_relevant else [],
                }
                return

            # Short-circuit: simple filtered-count query → answer directly, skip LLM.
            # DB is authoritative for count queries.
            direct = _try_direct_count_response(analytics_results, query_meta)
            logger.debug("[SC-STREAM] direct=%r analytics_keys=%s", direct, list(analytics_results.keys()))
            if direct is not None:
                yield direct
                self._update_context(session_id, query, direct, intent, selected, query_meta)
                self._last_stream_meta[session_id] = {
                    "intent": intent, "source": "mongodb_aggregation", "confidence": 1.0,
                    "collections_used": selected, "routing": "analytics_direct",
                    "citations": [],
                }
                return

            context_text = build_analytics_context(analytics_results)
            # Supplement with raw records for comparison or small collections
            # so the LLM has actual field values (not just aggregated numbers)
            if sample_fetched:
                sample_total = sum(
                    p.get("total_count", 0) for p in sample_fetched.values() if isinstance(p, dict)
                )
                has_group_by = any(
                    isinstance(v, dict) and "group_by" in v
                    for v in analytics_results.values()
                )
                if (intent == "comparison" and not has_group_by) or sample_total <= 500:
                    sample_ctx = build_context(sample_fetched)
                    if sample_ctx:
                        context_text = context_text + "\n\n--- ACTUAL RECORDS ---\n" + sample_ctx
            rag_text = build_rag_context(rag_chunks)
            if rag_text:
                context_text = rag_text + "\n\n" + context_text
            system_content = self._build_intent_system(
                context_text, intent, False,
                query_meta=query_meta,
                user_query=resolved_query,
                citation_filenames=source_filenames,
                analytics_results=analytics_results,
            )
            msgs = [{"role": "system", "content": system_content}]
            msgs.append({"role": "user", "content": resolved_query})
            full = []
            async for token in self._llm.stream(msgs):
                yield token
                full.append(token)
            response_text = "".join(full)
            self._update_context(session_id, query, response_text, intent, selected, query_meta)
            self._last_stream_meta[session_id] = {
                "intent": intent, "source": "mongodb_aggregation", "confidence": 1.0,
                "collections_used": selected, "routing": "analytics",
                "citations": self._extract_citations(response_text, source_filenames),
            }
            return

        if intent == "data_query":
            # Paginated retrieval path
            t5 = time.perf_counter()
            (fetched, total_records, total_pages), (rag_chunks, source_filenames) = await asyncio.gather(
                self._fetch_paginated(
                    resolved_query, selected, expanded_kw, query_vector, page, DATA_QUERY_PAGE_SIZE,
                    query_meta=query_meta,
                ),
                rag_task,
            )
            logger.info(
                "[STAGE 5][STREAM][DATA_QUERY] fetch_ms=%.0f total=%d pages=%d rag_chunks=%d",
                _ms(t5), total_records, total_pages, len(rag_chunks),
            )

            if not fetched and not rag_chunks:
                _fb_full: list[str] = []
                try:
                    async for _tok in self._llm.stream([
                        {"role": "system", "content": _intents.NO_DATA},
                        {"role": "user", "content": resolved_query},
                    ]):
                        yield _tok
                        _fb_full.append(_tok)
                except Exception:
                    yield _NO_DATA_RESPONSE
                    _fb_full = [_NO_DATA_RESPONSE]
                _fb_text = "".join(_fb_full)
                self._update_context(session_id, query, _fb_text, intent, [], None)
                self._last_stream_meta[session_id] = {
                    "intent": intent, "source": "none", "confidence": 0.0,
                    "collections_used": [], "routing": "llm_fallback",
                    "citations": [],
                }
                return

            validation = validate_retrieval(resolved_query, fetched, bool(query_vector), query_meta)
            ctx_source = select_context_source(rag_chunks, validation, RAG_CONFIDENCE_THRESHOLD)

            if ctx_source == "rag_only":
                context_text = build_rag_only_context(rag_chunks)
            elif ctx_source == "merged":
                context_text = build_merged_context(rag_chunks, fetched)
            else:
                context_text = build_context(fetched, page=page, page_size=DATA_QUERY_PAGE_SIZE)

            low_conf = ctx_source == "db_only" and validation.recommendation == "low_confidence"
            system_content = self._build_intent_system(
                context_text, intent, low_conf,
                query_meta=query_meta,
                fetched=None if ctx_source == "rag_only" else fetched,
                user_query=resolved_query,
                citation_filenames=source_filenames,
            )
            msgs = [{"role": "system", "content": system_content}]
            msgs.append({"role": "user", "content": resolved_query})
            full = []
            async for token in self._llm.stream(msgs):
                yield token
                full.append(token)
            response_text = "".join(full)
            collections_used = [] if ctx_source == "rag_only" else list(fetched.keys())
            self._update_context(session_id, query, response_text, intent, collections_used, query_meta)
            self._last_stream_meta[session_id] = {
                "intent": intent,
                "source": "rag_document" if ctx_source == "rag_only" else validation.source,
                "confidence": 1.0 if ctx_source in ("rag_only", "merged") else validation.confidence,
                "collections_used": collections_used,
                "routing": f"data_query_{ctx_source}",
                "citations": self._extract_citations(response_text, source_filenames),
                "pagination": {
                    "total_records": 0 if ctx_source == "rag_only" else total_records,
                    "page": page,
                    "page_size": DATA_QUERY_PAGE_SIZE,
                    "total_pages": 1 if ctx_source == "rag_only" else total_pages,
                },
            }
            return

        # Summary / Forecasting path — sampled fetch
        t5 = time.perf_counter()
        _cache = get_db_cache()
        _cache_key = None if user_id else _cache.make_key(intent, selected, query_meta)
        _cached = _cache.get(_cache_key) if _cache_key else None
        if intent == "summary":
            if _cached:
                fetched = _cached["sample_fetched"]
                stream_summary_agg = _cached["analytics_results"]
                rag_chunks, source_filenames = await rag_task
                logger.info("[CACHE][STREAM] hit intent=summary key=%s", _cache_key)
            else:
                fetched, stream_summary_agg, (rag_chunks, source_filenames) = await asyncio.gather(
                    self._fetch_sample(resolved_query, selected, expanded_kw, query_vector, query_meta),
                    run_analytics(query_meta, selected, self._metadata, self._repo, top_n=query_meta.top_n),
                    rag_task,
                )
                if _cache_key:
                    _cache.set(_cache_key, {"analytics_results": stream_summary_agg, "sample_fetched": fetched})
        else:
            stream_summary_agg = {}
            if _cached:
                fetched = _cached["sample_fetched"]
                rag_chunks, source_filenames = await rag_task
                logger.info("[CACHE][STREAM] hit intent=%s key=%s", intent, _cache_key)
            else:
                fetched, (rag_chunks, source_filenames) = await asyncio.gather(
                    self._fetch_sample(resolved_query, selected, expanded_kw, query_vector, query_meta),
                    rag_task,
                )
                if _cache_key:
                    _cache.set(_cache_key, {"analytics_results": {}, "sample_fetched": fetched})
        logger.info(
            "[STAGE 5][STREAM][SAMPLE] fetch_ms=%.0f collections=%s rag_chunks=%d",
            _ms(t5), list(fetched.keys()), len(rag_chunks),
        )

        validation = validate_retrieval(resolved_query, fetched, bool(query_vector), query_meta)
        if validation.recommendation == "no_data" and not rag_chunks:
            _fb_full: list[str] = []
            try:
                async for _tok in self._llm.stream([
                    {"role": "system", "content": _intents.NO_DATA},
                    {"role": "user", "content": resolved_query},
                ]):
                    yield _tok
                    _fb_full.append(_tok)
            except Exception:
                yield _NO_DATA_RESPONSE
                _fb_full = [_NO_DATA_RESPONSE]
            _fb_text = "".join(_fb_full)
            self._update_context(session_id, query, _fb_text, intent, [], None)
            self._last_stream_meta[session_id] = {
                "intent": intent, "source": "none", "confidence": 0.0,
                "collections_used": [], "routing": "llm_fallback",
                "citations": [],
            }
            return

        ctx_source = select_context_source(rag_chunks, validation, RAG_CONFIDENCE_THRESHOLD)

        def _build_stream_db_ctx(fetched_data: dict) -> str:
            sample_ctx = build_context(fetched_data)
            if stream_summary_agg and any(v for v in stream_summary_agg.values()):
                agg_ctx = build_analytics_context(stream_summary_agg)
                return (agg_ctx + "\n\n--- SAMPLE RECORDS ---\n" + sample_ctx) if sample_ctx else agg_ctx
            return sample_ctx

        if ctx_source == "rag_only":
            context_text = build_rag_only_context(rag_chunks)
        elif ctx_source == "merged":
            context_text = build_merged_context(rag_chunks, fetched)
        else:
            context_text = _build_stream_db_ctx(fetched)

        low_conf = ctx_source == "db_only" and validation.recommendation == "low_confidence"
        system_content = self._build_intent_system(
            context_text, intent, low_conf,
            query_meta=query_meta,
            fetched=None if ctx_source == "rag_only" else fetched,
            user_query=resolved_query,
            citation_filenames=source_filenames,
        )
        msgs = [{"role": "system", "content": system_content}]
        msgs.append({"role": "user", "content": resolved_query})
        collections_used = [] if ctx_source == "rag_only" else list(fetched.keys())
        full = []
        async for token in self._llm.stream(msgs):
            yield token
            full.append(token)
        response_text = "".join(full)
        self._update_context(session_id, query, response_text, intent, collections_used, query_meta)
        self._last_stream_meta[session_id] = {
            "intent": intent,
            "source": "rag_document" if ctx_source == "rag_only" else validation.source,
            "confidence": 1.0 if ctx_source in ("rag_only", "merged") else validation.confidence,
            "collections_used": collections_used,
            "routing": f"sample_{ctx_source}",
            "citations": self._extract_citations(response_text, source_filenames),
        }

    # -- DB pipeline (non-streaming) -------------------------------------------

    async def _db_pipeline(
        self,
        query: str,
        query_meta: QueryMeta,
        intent: str,
        conversation_history: Optional[list[dict]],
        session_id: str,
        timings: dict,
        page: int = 1,
        user_id: str = "",
        org_id: str = "",
        dashboard_context: str = "",
    ) -> StructuredResponse:
        """Stages 3-9 for the non-streaming path."""
        pipeline_start = time.perf_counter()

        # Stage 3: Collection selection
        t3 = time.perf_counter()
        selected = await select_collections(query, self._metadata, self._llm)
        if dashboard_context in _intents.SCOPED_COLLECTION:
            selected = [_intents.SCOPED_COLLECTION[dashboard_context]]
        timings["collection_selection_ms"] = _ms(t3)
        logger.info("[STAGE 3] selected=%s", selected)

        # Stage 4: Semantic keyword build
        t4 = time.perf_counter()
        base_kw = _extract_keywords(query)
        meta_hints = query_meta.search_hints()
        combined_base = list(dict.fromkeys(base_kw + meta_hints))
        expanded_kw, query_vector = await asyncio.gather(
            build_search_terms(query, combined_base, self._llm),
            get_query_embedding(query),
        )
        timings["semantic_expand_ms"] = _ms(t4)

        used_vector = bool(query_vector)
        # ── PATH A: Analytics / Comparison — run DB aggregations ─────────────
        if intent in ("analytics", "comparison"):
            t5 = time.perf_counter()
            _cache = get_db_cache()
            _cache_key = None if user_id else _cache.make_key(intent, selected, query_meta)
            _cached = _cache.get(_cache_key) if _cache_key else None
            if _cached:
                analytics_results = _cached["analytics_results"]
                sample_fetched = _cached["sample_fetched"]
                rag_chunks, source_filenames = await self._fetch_rag_chunks(query, query_vector, user_id, RAG_TOP_K, org_id=org_id)
                logger.info("[CACHE] hit intent=%s key=%s", intent, _cache_key)
            else:
                analytics_results, sample_fetched, (rag_chunks, source_filenames) = await asyncio.gather(
                    run_analytics(query_meta, selected, self._metadata, self._repo, top_n=query_meta.top_n),
                    self._fetch_sample(query, selected, expanded_kw, query_vector, query_meta),
                    self._fetch_rag_chunks(query, query_vector, user_id, RAG_TOP_K, org_id=org_id),
                )
                if _cache_key and analytics_results:
                    _cache.set(_cache_key, {"analytics_results": analytics_results, "sample_fetched": sample_fetched})
            timings["analytics_ms"] = _ms(t5)

            if not analytics_results or all(not v for v in analytics_results.values()):
                _rag_conf = compute_rag_confidence(rag_chunks)
                _rag_relevant = rag_chunks and _rag_conf >= RAG_CONFIDENCE_THRESHOLD
                if _rag_relevant:
                    rag_text = build_rag_context(rag_chunks)
                    _nd_system = (
                        "You are VOXA, an AI Assistant. No database records were found for this query, "
                        "but the user has uploaded knowledge documents that may contain the answer.\n\n"
                        "--- KNOWLEDGE BASE ---\n"
                        f"{rag_text}\n"
                        "--- END KNOWLEDGE BASE ---\n\n"
                        "Answer the user's question based on the knowledge base above. "
                        "If the answer is not present, say so clearly."
                    )
                    _nd_source = "rag_document"
                else:
                    _nd_system = _NO_DATA_SYSTEM
                    _nd_source = "none"
                msgs = [{"role": "system", "content": _nd_system}]
                if conversation_history:
                    msgs.extend(conversation_history[-8:])
                msgs.append({"role": "user", "content": query})
                try:
                    response_text = self._llm.complete(msgs)
                except Exception:
                    response_text = _NO_DATA_RESPONSE
                return compose(
                    response_text, selected, int(_ms(pipeline_start)),
                    confidence=_rag_conf if _rag_relevant else 0.0, source=_nd_source, intent=intent,
                    success=_rag_relevant, metadata={**timings, "no_data": not _rag_relevant},
                )

            # Short-circuit: simple filtered-count query → answer directly, skip LLM.
            # DB is authoritative for count queries — ignore rag_chunks.
            direct = _try_direct_count_response(analytics_results, query_meta)
            if direct:
                return compose(
                    direct, selected, int(_ms(pipeline_start)),
                    confidence=1.0, source="mongodb_aggregation", intent=intent,
                    metadata={**timings, "routing": "analytics_direct"},
                )

            context_text = build_analytics_context(analytics_results)
            if sample_fetched:
                sample_total = sum(
                    p.get("total_count", 0) for p in sample_fetched.values() if isinstance(p, dict)
                )
                has_group_by = any(
                    isinstance(v, dict) and "group_by" in v
                    for v in analytics_results.values()
                )
                if (intent == "comparison" and not has_group_by) or sample_total <= 500:
                    sample_ctx = build_context(sample_fetched)
                    if sample_ctx:
                        context_text = context_text + "\n\n--- ACTUAL RECORDS ---\n" + sample_ctx
            rag_text = build_rag_context(rag_chunks)
            if rag_text:
                context_text = rag_text + "\n\n" + context_text
            system_content = self._build_intent_system(
                context_text, intent, False,
                query_meta=query_meta,
                user_query=query,
                citation_filenames=source_filenames,
                analytics_results=analytics_results,
            )
            msgs = [{"role": "system", "content": system_content}]
            msgs.append({"role": "user", "content": query})
            try:
                response_text = self._llm.complete(msgs)
            except Exception as exc:
                logger.error("LLM narration failed (analytics): %s", exc)
                response_text = "I found the data but could not generate a response right now."
            timings["llm_narration_ms"] = _ms(t4)
            return compose(
                response_text, selected, int(_ms(pipeline_start)),
                confidence=1.0, source="mongodb_aggregation", intent=intent,
                citations=self._extract_citations(response_text, source_filenames),
                metadata={**timings, "query_meta": query_meta.to_dict()},
            )

        # ── PATH B: Data Query — paginated document fetch ─────────────────────
        if intent == "data_query":
            t5 = time.perf_counter()
            (fetched, total_records, total_pages), (rag_chunks, source_filenames) = await asyncio.gather(
                self._fetch_paginated(
                    query, selected, expanded_kw, query_vector, page, DATA_QUERY_PAGE_SIZE,
                    query_meta=query_meta,
                ),
                self._fetch_rag_chunks(query, query_vector, user_id, RAG_TOP_K, org_id=org_id),
            )
            timings["data_fetch_ms"] = _ms(t5)

            if not fetched and not rag_chunks:
                try:
                    _fb_response = self._llm.complete([
                        {"role": "system", "content": _intents.NO_DATA},
                        {"role": "user", "content": query},
                    ])
                except Exception:
                    _fb_response = _NO_DATA_RESPONSE
                return compose(
                    _fb_response, [], int(_ms(pipeline_start)),
                    confidence=0.0, source="none", intent=intent,
                    success=False, metadata={**timings, "no_data": True},
                )

            validation = validate_retrieval(query, fetched, bool(query_vector), query_meta)
            ctx_source = select_context_source(rag_chunks, validation, RAG_CONFIDENCE_THRESHOLD)

            if ctx_source == "rag_only":
                context_text = build_rag_only_context(rag_chunks)
            elif ctx_source == "merged":
                context_text = build_merged_context(rag_chunks, fetched)
            else:
                context_text = build_context(fetched, page=page, page_size=DATA_QUERY_PAGE_SIZE)

            low_conf = ctx_source == "db_only" and validation.recommendation == "low_confidence"
            system_content = self._build_intent_system(
                context_text, intent, low_conf,
                query_meta=query_meta,
                fetched=None if ctx_source == "rag_only" else fetched,
                user_query=query,
                citation_filenames=source_filenames,
            )
            msgs = [{"role": "system", "content": system_content}]
            msgs.append({"role": "user", "content": query})
            try:
                response_text = self._llm.complete(msgs)
            except Exception as exc:
                logger.error("LLM narration failed (data_query): %s", exc)
                response_text = "I found records but could not generate a response right now."
            timings["llm_narration_ms"] = _ms(t5)

            result = compose(
                response_text,
                [] if ctx_source == "rag_only" else list(fetched.keys()),
                int(_ms(pipeline_start)),
                confidence=1.0 if ctx_source in ("rag_only", "merged") else validation.confidence,
                source="rag_document" if ctx_source == "rag_only" else validation.source,
                intent=intent,
                citations=self._extract_citations(response_text, source_filenames),
                metadata={**timings, "query_meta": query_meta.to_dict()},
            )
            result.metadata["pagination"] = {
                "total_records": 0 if ctx_source == "rag_only" else total_records,
                "page": page,
                "page_size": DATA_QUERY_PAGE_SIZE,
                "total_pages": 1 if ctx_source == "rag_only" else total_pages,
            }
            return result

        # ── PATH C: Summary / Forecasting — sampled fetch ─────────────────────
        t5 = time.perf_counter()
        _cache = get_db_cache()
        _cache_key = None if user_id else _cache.make_key(intent, selected, query_meta)
        _cached = _cache.get(_cache_key) if _cache_key else None
        if intent == "summary":
            if _cached:
                fetched = _cached["sample_fetched"]
                summary_agg = _cached["analytics_results"]
                rag_chunks, source_filenames = await self._fetch_rag_chunks(query, query_vector, user_id, RAG_TOP_K, org_id=org_id)
                logger.info("[CACHE] hit intent=summary key=%s", _cache_key)
            else:
                fetched, summary_agg, (rag_chunks, source_filenames) = await asyncio.gather(
                    self._fetch_sample(query, selected, expanded_kw, query_vector, query_meta),
                    run_analytics(query_meta, selected, self._metadata, self._repo, top_n=query_meta.top_n),
                    self._fetch_rag_chunks(query, query_vector, user_id, RAG_TOP_K, org_id=org_id),
                )
                if _cache_key:
                    _cache.set(_cache_key, {"analytics_results": summary_agg, "sample_fetched": fetched})
        else:
            summary_agg = {}
            if _cached:
                fetched = _cached["sample_fetched"]
                rag_chunks, source_filenames = await self._fetch_rag_chunks(query, query_vector, user_id, RAG_TOP_K, org_id=org_id)
                logger.info("[CACHE] hit intent=%s key=%s", intent, _cache_key)
            else:
                fetched, (rag_chunks, source_filenames) = await asyncio.gather(
                    self._fetch_sample(query, selected, expanded_kw, query_vector, query_meta),
                    self._fetch_rag_chunks(query, query_vector, user_id, RAG_TOP_K, org_id=org_id),
                )
                if _cache_key:
                    _cache.set(_cache_key, {"analytics_results": {}, "sample_fetched": fetched})
        timings["data_fetch_ms"] = _ms(t5)

        validation = validate_retrieval(query, fetched, bool(query_vector), query_meta)
        if validation.recommendation == "no_data" and not rag_chunks:
            try:
                _fb_response = self._llm.complete([
                    {"role": "system", "content": _intents.NO_DATA},
                    {"role": "user", "content": query},
                ])
            except Exception:
                _fb_response = _NO_DATA_RESPONSE
            return compose(
                _fb_response, [], int(_ms(pipeline_start)),
                confidence=0.0, source="none", intent=intent,
                success=False, metadata={**timings, "no_data": True},
            )

        ctx_source = select_context_source(rag_chunks, validation, RAG_CONFIDENCE_THRESHOLD)

        def _build_db_ctx(fetched_data: dict) -> str:
            sample_ctx = build_context(fetched_data)
            if summary_agg and any(v for v in summary_agg.values()):
                agg_ctx = build_analytics_context(summary_agg)
                return (agg_ctx + "\n\n--- SAMPLE RECORDS ---\n" + sample_ctx) if sample_ctx else agg_ctx
            return sample_ctx

        if ctx_source == "rag_only":
            context_text = build_rag_only_context(rag_chunks)
        elif ctx_source == "merged":
            context_text = build_merged_context(rag_chunks, fetched)
        else:
            context_text = _build_db_ctx(fetched)

        # Stage 8: LLM narration
        t8 = time.perf_counter()
        low_conf = ctx_source == "db_only" and validation.recommendation == "low_confidence"
        system_content = self._build_intent_system(
            context_text, intent, low_conf, query_meta=query_meta,
            fetched=None if ctx_source == "rag_only" else fetched,
            user_query=query, citation_filenames=source_filenames,
        )
        msgs = [{"role": "system", "content": system_content}]
        msgs.append({"role": "user", "content": query})
        try:
            response_text = self._llm.complete(msgs)
        except Exception as exc:
            logger.error("LLM narration failed (%s): %s", intent, exc)
            response_text = "I found records but could not generate a response right now."
        timings["llm_narration_ms"] = _ms(t5)

        raw_data: list[dict] = []
        if ctx_source != "rag_only":
            for payload in fetched.values():
                raw_data.extend(payload.get("samples", [])[:5])

        return compose(
            response_text,
            [] if ctx_source == "rag_only" else list(fetched.keys()),
            int(_ms(pipeline_start)),
            confidence=1.0 if ctx_source in ("rag_only", "merged") else validation.confidence,
            source="rag_document" if ctx_source == "rag_only" else validation.source,
            intent=intent,
            data=raw_data[:20],
            citations=self._extract_citations(response_text, source_filenames),
            metadata={**timings, "query_meta": query_meta.to_dict(), "validation_reason": validation.reason},
        )

    # ── Paginated fetch for data_query ────────────────────────────────────────

    async def _fetch_paginated(
        self,
        query: str,
        collection_names: list[str],
        expanded_keywords: list[str],
        query_vector: Optional[list[float]],
        page: int,
        page_size: int,
        query_meta=None,  # QueryMeta | None - used to build an AND pre-filter
    ) -> tuple[dict[str, dict], int, int]:
        """
        Paginated document fetch for data_query intent.
        Returns (fetched_dict, total_records_across_collections, total_pages).

        Strategy (per collection):
          1. Vector search   — returns scored matches, no arbitrary cap
          2. Keyword search  — regex OR across text fields, ANDed with any
                               structured filter derived from query_meta.filters
          3. Filtered scan   — query_meta.filters applied as $match when
                               keywords produced no results
          4. Fallback scan   — capped at _FALLBACK_SCAN_LIMIT; only reached
                               when all other strategies return nothing
          +  Aggregation     — if query_meta specifies grouping, a MongoDB
                               $group pipeline is computed and stored alongside
                               the raw samples so the LLM has pre-computed totals
        Fetch priority per collection:
          1. Structured AND filter from query_meta.filters  (most precise)
          2. Keyword OR search across searchable fields
          3. Plain paginated sample                         (fallback)
        """
        if not self._repo or not collection_names:
            return {}, 0, 1

        async def _fetch_one(name: str) -> tuple[str, dict]:
            try:
                meta = self._metadata.get(name, {})
                fields = meta.get("searchable_fields") or meta.get("fields", [])
                docs: list[dict] = []
                total_matching = 0
                fetch_source = "fallback_paginated"
                had_filter = False

                # ── Resolve time-range → MongoDB date filter (dynamic) ───────
                time_filter: dict = {}
                if query_meta and getattr(query_meta, "time_range", None) and fields:
                    _date_field = _find_date_field(fields)
                    if _date_field:
                        time_filter = _resolve_time_range_to_filter(
                            query_meta.time_range, _date_field
                        )
                        if time_filter:
                            logger.info(
                                "[FETCH-PAGED] time_range=%r → %s",
                                query_meta.time_range, time_filter,
                            )

                # ── Priority 1: structured AND filter (field filters + time range) ──
                field_filter: dict = {}
                if query_meta and query_meta.filters and fields:
                    field_filter = _build_exact_filter(query_meta.filters, fields)
                combined_filter = {**field_filter, **time_filter}

                if combined_filter:
                    had_filter = True
                    docs, total_matching = await self._repo.find_paginated(
                        name, combined_filter, page=page, page_size=page_size
                    )
                    if docs:
                        fetch_source = "mongodb_filter"
                        logger.info(
                            "[FETCH-PAGED] collection=%s filter=%s matched=%d",
                            name, combined_filter, total_matching,
                        )

                # ── Priority 2: keyword OR search ─────────────────────────────
                if not docs and expanded_keywords and fields:
                    searchable = [
                        f for f in fields
                        if not any(kw in f.lower() for kw in ["date", "time", "_at"])
                    ][:10]
                    docs, total_matching = await self._repo.keyword_search_paginated(
                        name, expanded_keywords, searchable or None,
                        page=page, page_size=page_size
                    )
                    if docs:
                        fetch_source = "mongodb_keyword"

                # ── Priority 3: fallback scan — only when no filter was applied ──
                # If any filter (field or time) was applied and returned nothing,
                # the data doesn't exist for that scope — don't return unrelated records.
                if not docs and not had_filter:
                    docs, total_matching = await self._repo.find_paginated(
                        name, page=page, page_size=page_size
                    )

                if not docs:
                    return name, {}

                total_count = await self._repo.count(name)
                logger.info(
                    "[FETCH-PAGED] collection=%s total=%d matching=%d page=%d returned=%d source=%s",
                    name, total_count, total_matching, page, len(docs), fetch_source,
                )
                return name, {
                    "samples": docs,
                    "total_count": total_count,
                    "total_matching": total_matching,
                    "source": fetch_source,
                }
            except Exception as exc:
                logger.debug("Paginated fetch failed for '%s': %s", name, exc)
                return name, {}

        tasks = [_fetch_one(n) for n in collection_names]
        try:
            results = await asyncio.wait_for(
                asyncio.gather(*tasks), timeout=FETCH_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            logger.warning("[FETCH-PAGED] timed out after %.0fs", FETCH_TIMEOUT_SECONDS)
            results = []

        fetched = {name: payload for name, payload in results if payload}
        total_matching = sum(p.get("total_matching", 0) for p in fetched.values())
        total_pages = max(1, -(-total_matching // page_size))
        return fetched, total_matching, total_pages

    # ── Sampled fetch for summary/forecasting ────────────────────────────────

    async def _fetch_sample(
        self,
        query: str,
        collection_names: list[str],
        expanded_keywords: list[str],
        query_vector: Optional[list[float]],
        query_meta=None,
    ) -> dict[str, dict]:
        """
        Fetch a representative sample for summary/forecasting.
        Uses keyword search capped at SAMPLE_SIZE records.
        """
        if not self._repo or not collection_names:
            return {}

        def _build_structured_filter(meta_fields: list[str]) -> dict:
            """
            Translate query_meta.filters into a MongoDB $match dict.

            Only applies conditions for filter keys that match a real field
            in the collection (case-insensitive) to avoid false empty results.
            - Boolean adjectives ("active"/"inactive") resolve to is_<adjective> fields.
            - Status-like strings use partial (contains) regex for UNDER_MAINTENANCE-style values.
            """
            if not query_meta or not query_meta.filters:
                return {}
            from orchestrator.analytics_executor import (
                _ACTIVE_ADJECTIVES, _NEGATIVE_TO_POSITIVE,
            )
            all_fields_lower = {f.lower(): f for f in meta_fields}
            conditions: list[dict] = []
            for key, value in query_meta.filters.items():
                # Boolean adjective shortcut (e.g. "status"="active" → is_active=True)
                # Negative adjectives try positive field with False (e.g. "inactive" → is_active=False)
                if isinstance(value, str) and value.lower() in _ACTIVE_ADJECTIVES:
                    bool_field_name = f"is_{value.lower()}"
                    if bool_field_name in all_fields_lower:
                        conditions.append(
                            {all_fields_lower[bool_field_name]: _ACTIVE_ADJECTIVES[value.lower()]}
                        )
                        continue
                    positive = _NEGATIVE_TO_POSITIVE.get(value.lower())
                    if positive:
                        pos_field = f"is_{positive}"
                        if pos_field in all_fields_lower:
                            conditions.append({all_fields_lower[pos_field]: False})
                            continue

                matched_field = all_fields_lower.get(key.lower())
                if not matched_field:
                    # try substring: "condition" matches "medical_condition"
                    matched_field = next(
                        (f for fl, f in all_fields_lower.items() if key.lower() in fl),
                        None,
                    )
                if matched_field is None:
                    continue
                if isinstance(value, str):
                    if any(matched_field.lower().endswith(s) for s in ("_id", "_number", "_code")):
                        # Exact match for ID-like fields
                        conditions.append(
                            {matched_field: {"$regex": f"^{re.escape(value)}$", "$options": "i"}}
                        )
                    else:
                        # Partial match so "maintenance" finds "UNDER_MAINTENANCE"
                        conditions.append(
                            {matched_field: {"$regex": re.escape(value), "$options": "i"}}
                        )
                elif isinstance(value, (int, float, bool)):
                    conditions.append({matched_field: value})
            if not conditions:
                return {}
            return conditions[0] if len(conditions) == 1 else {"$and": conditions}

        def _find_field(candidates: list[str], key: str) -> Optional[str]:
            """Return the first field that case-insensitively matches or contains *key*."""
            key_l = key.lower()
            for f in candidates:
                if f.lower() == key_l:
                    return f
            for f in candidates:
                if key_l in f.lower():
                    return f
            return None

        async def _fetch_one(name: str) -> tuple[str, dict]:
            try:
                meta = self._metadata.get(name, {})
                all_fields: list[str] = meta.get("fields", [])
                fields = meta.get("searchable_fields") or all_fields
                total = await self._repo.count(name)
                docs: list[dict] = []
                fetch_source = "fallback_scan"

                # Build a structured filter from query_meta.filters (may be empty)
                structured_filter = _build_structured_filter(all_fields)

                # Merge time-range filter (dynamic, resolved from query_meta.time_range)
                if query_meta and getattr(query_meta, "time_range", None):
                    _sf_date_field = _find_date_field(all_fields)
                    if _sf_date_field:
                        _tf = _resolve_time_range_to_filter(
                            query_meta.time_range, _sf_date_field
                        )
                        if _tf:
                            structured_filter = {**structured_filter, **_tf}
                            logger.info(
                                "[FETCH] time_range=%r → %s",
                                query_meta.time_range, _tf,
                            )

                if query_vector:
                    docs = await self._repo.vector_search(
                        name, query_vector,
                        vector_field=_EMBEDDING_FIELD,
                        index_name=_EMBEDDING_INDEX,
                        limit=SAMPLE_SIZE,
                    )
                    if docs:
                        fetch_source = "mongodb_vector"

                # 2. Keyword search — ANDed with structured filter when present
                if not docs and expanded_keywords and fields:
                    _EXACT_EXCLUDE = {
                        "_id", "id", "date", "time", "timestamp",
                        "created_at", "updated_at", "deleted_at",
                    }
                    _SUFFIX_EXCLUDE = ("_id", ".id", "_key", ".key", "_at")
                    searchable = [
                        f for f in fields
                        if f.lower() not in _EXACT_EXCLUDE
                        and not f.lower().endswith(_SUFFIX_EXCLUDE)
                    ][:15]
                    docs = await self._repo.keyword_search(
                        name, expanded_keywords, searchable or None,
                        extra_filter=structured_filter or None,
                        limit=SAMPLE_SIZE,
                    )
                    if docs:
                        fetch_source = "mongodb_keyword"

                # 3. Filtered scan — use structured filter before falling back blind
                if not docs and structured_filter:
                    docs = await self._repo.find(
                        name, structured_filter, limit=_FALLBACK_SCAN_LIMIT
                    )
                    if docs:
                        fetch_source = "mongodb_filtered"

                # 4. Blind scan only when NO structured filter was applied.
                # If a filter was applied and returned nothing, the requested entity
                # does not exist — returning unrelated records causes hallucination.
                if not docs and not structured_filter:
                    docs = await self._repo.find(name, limit=SAMPLE_SIZE)
                if not docs and not structured_filter:
                    docs = await self._repo.find(name, limit=_FALLBACK_SCAN_LIMIT)

                # Aggregation — compute group-by results when the query asks for them
                agg_results: Optional[list[dict]] = None
                if (
                    query_meta
                    and query_meta.grouping
                    and "group_by" in (query_meta.aggregations or [])
                ):
                    group_field = _find_field(all_fields, query_meta.grouping)
                    if group_field:
                        try:
                            agg_pipeline: list[dict] = []
                            if structured_filter:
                                agg_pipeline.append({"$match": structured_filter})

                            group_expr: dict = {
                                "_id": f"${group_field}",
                                "count": {"$sum": 1},
                            }
                            # Add metric accumulators for any matching fields
                            for agg_op in (query_meta.aggregations or []):
                                if agg_op in ("count", "group_by"):
                                    continue
                                for metric in (query_meta.metrics or [])[:2]:
                                    mf = _find_field(all_fields, metric)
                                    if not mf:
                                        continue
                                    if agg_op == "sum":
                                        group_expr[f"total_{metric}"] = {"$sum": f"${mf}"}
                                    elif agg_op in ("avg", "average"):
                                        group_expr[f"avg_{metric}"] = {"$avg": f"${mf}"}
                                    elif agg_op == "max":
                                        group_expr[f"max_{metric}"] = {"$max": f"${mf}"}
                                    elif agg_op == "min":
                                        group_expr[f"min_{metric}"] = {"$min": f"${mf}"}

                            agg_pipeline.extend([
                                {"$group": group_expr},
                                {"$sort": {"count": -1}},
                                {"$limit": 100},
                            ])
                            agg_results = await self._repo.aggregate(name, agg_pipeline)
                            logger.info(
                                "[FETCH] aggregation: collection=%s group_by=%s(%s) rows=%d",
                                name, query_meta.grouping, group_field, len(agg_results or []),
                            )
                        except Exception as exc:
                            logger.debug("Aggregation failed for '%s': %s", name, exc)

                if not docs and not agg_results:
                    return name, {}

                matching_count = len(docs)
                if matching_count > _CONTEXT_SAMPLE_LIMIT:
                    docs = docs[:_CONTEXT_SAMPLE_LIMIT]

                logger.info(
                    "[FETCH] collection=%s total=%s matching=%s context_sample=%s "
                    "source=%s structured_filter=%s agg_rows=%s",
                    name, total, matching_count, len(docs), fetch_source,
                    bool(structured_filter), len(agg_results) if agg_results else 0,
                )
                payload: dict = {
                    "samples": docs,
                    "total_count": total,
                    "matching_count": matching_count,
                    "source": fetch_source,
                }
                if agg_results:
                    payload["aggregations"] = agg_results
                return name, payload
            except Exception as exc:
                logger.debug("Sample fetch failed for '%s': %s", name, exc)
                return name, {}

        tasks = [_fetch_one(n) for n in collection_names]
        try:
            results = await asyncio.wait_for(
                asyncio.gather(*tasks), timeout=FETCH_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            logger.warning("[FETCH-SAMPLE] timed out after %.0fs", FETCH_TIMEOUT_SECONDS)
            results = []

        return {name: payload for name, payload in results if payload}

    # ── Structured filter builder ─────────────────────────────────────────────

    # ── RAG helpers ───────────────────────────────────────────────────────────

    async def _fetch_rag_chunks(
        self,
        query: str,
        query_vector: Optional[list[float]],
        user_id: str,
        top_k: int,
        org_id: str = "",
    ) -> tuple[list[dict], list[str]]:
        """
        Stage 5b — retrieve relevant document chunks from rag_chunks collection.
        Returns (chunks, source_filenames).  Never raises; failures return ([], []).
        Passes org_id so the retriever can union user-scoped and org-scoped chunks.
        """
        if not user_id:
            logger.warning("[RAG] _fetch_rag_chunks called with empty user_id — skipping")
            return [], []
        db = get_db()
        if db is None:
            logger.warning("[RAG] database unavailable — skipping RAG retrieval")
            return [], []
        logger.info(
            "[RAG] fetching chunks: user=%s org=%s vector=%s query=%r",
            user_id[:8] + "...", org_id or "none",
            "yes" if query_vector else "no (keyword fallback)",
            query[:60],
        )
        try:
            from rag.retriever import retrieve_chunks
            chunks, filenames = await retrieve_chunks(
                db, query_vector, query, user_id, top_k, org_id=org_id or None
            )
            logger.info(
                "[RAG] retrieved %d chunks from %d file(s): %s",
                len(chunks), len(filenames), filenames,
            )
            return chunks, filenames
        except Exception as exc:
            logger.warning("[RAG] retrieval failed (non-fatal): %s", exc)
            return [], []

    @staticmethod
    def _extract_citations(response_text: str, allowed_filenames: list[str]) -> list[str]:
        """
        Scan the completed response for any filename from the allowed list.
        Case-insensitive membership check — no regex, no format assumptions.
        Only filenames explicitly passed by the retriever can appear as citations,
        preventing hallucinated references.
        """
        if not allowed_filenames:
            return []
        text_lower = response_text.lower()
        return [f for f in allowed_filenames if f.lower() in text_lower]

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _build_intent_system(
        context_text: str,
        intent: str,
        low_confidence: bool = False,
        query_meta=None,
        fetched: Optional[dict] = None,
        user_query: str = "",
        citation_filenames: Optional[list] = None,
        analytics_results: Optional[dict] = None,
    ) -> str:
        """Build the retrieval-aware system prompt with intent-specific context."""
        doc_counts: dict[str, int] = {}    # filtered/matching counts
        total_counts: dict[str, int] = {}  # whole-collection counts
        collections: list[str] = []
        if fetched:
            collections = list(fetched.keys())
            for name, payload in fetched.items():
                doc_counts[name] = payload.get(
                    "matching_count", len(payload.get("samples", []))
                )
                total_counts[name] = payload.get(
                    "total_count", doc_counts[name]
                )
        elif analytics_results:
            # Analytics path: only populate preamble counts for collections where a
            # filter was actually resolved (non-empty filter dict). Unfiltered collection
            # totals must not be summed — they are not the answer to a filtered query.
            collections = list(analytics_results.keys())
            for name, data in analytics_results.items():
                if "count" in data and data.get("filter"):
                    doc_counts[name] = data["count"]

        # has_filters must reflect whether a filter was *actually applied*, not just
        # whether one was requested. A dropped filter (field not found, etc.) must not
        # cause the preamble to claim "found exactly N matching records".
        if fetched:
            actually_filtered = any(
                isinstance(p, dict) and p.get("source") in ("mongodb_filter", "mongodb_filtered")
                for p in fetched.values()
            )
        elif analytics_results:
            actually_filtered = any(
                bool(data.get("filter")) for data in analytics_results.values()
            )
        else:
            actually_filtered = False

        ctx = PromptContext(
            intent=intent,
            data_context=context_text,
            has_results=bool(fetched) or bool(analytics_results),
            low_confidence=low_confidence,
            user_query=user_query,
            metrics=list(getattr(query_meta, "metrics", []) or []),
            entities=list(getattr(query_meta, "entities", []) or []),
            time_range=getattr(query_meta, "time_range", None),
            aggregations=list(getattr(query_meta, "aggregations", []) or []),
            collections=collections,
            doc_counts=doc_counts,
            total_counts=total_counts,
            has_filters=actually_filtered,
        )
        return _build_prompt(ctx)

    def _update_context(
        self,
        session_id: str,
        original_query: str,
        response_text: str,
        intent: str,
        collections_used: list[str],
        query_meta: Optional[object],   # QueryMeta | None
    ) -> None:
        if not session_id:
            return
        # Prefer structured time_range from normalization; fall back to regex
        time_range = None
        metric = None
        if query_meta is not None:
            try:
                time_range = getattr(query_meta, "time_range", None)
                metrics = getattr(query_meta, "metrics", [])
                metric = metrics[0] if metrics else None
            except Exception:
                pass
        if time_range is None:
            time_range = extract_time_range(original_query)

        # Entities: only real entities extracted by normalization. Collection
        # names are deliberately NOT added — they accumulated as fake "entities"
        # and the reference resolver then substituted them into later queries.
        # Collections are tracked separately via active_collections below.
        entities: list[str] = []
        if query_meta is not None:
            try:
                entities = list(getattr(query_meta, "entities", []))
            except Exception:
                pass
        entities = list(dict.fromkeys(entities))  # deduplicate preserving order

        self._ctx_store.update(
            session_id,
            entities=entities if entities else None,
            metric=metric,
            time_range=time_range,
            collections=collections_used if collections_used else None,
            intent=intent,
            query=original_query,
            response_snippet=response_text,
        )

    # ── ZOHO CRM helper (uncomment Block 1 import before using) ──────────────
    # async def _fetch_crm_data(self, query: str) -> list[dict]: ...


# ── Helper: milliseconds from a perf_counter start time ──────────────────────

def _ms(t_start: float) -> float:
    return (time.perf_counter() - t_start) * 1000


# ── Singleton ─────────────────────────────────────────────────────────────────

_orchestrator: Optional[QueryOrchestrator] = None


def get_orchestrator() -> QueryOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = QueryOrchestrator()
    return _orchestrator
