"""
Semantic keyword expander.

Two modes — both are active by default and complement each other:

Mode 1 · LLM expansion (always available)
  Uses a small LLM call to derive domain synonyms, abbreviations, and
  related terms from the user query.  The expanded set is merged with
  the base keywords and passed to MongoDB regex search, dramatically
  improving recall for queries like "top performers" → ["ranking",
  "leaders", "best", "highest", "score"].

Mode 2 · Embedding vector search (optional — activate via env vars)
  If EMBEDDING_MODEL is set, encodes the query as a dense vector and
  runs MongoDB Atlas $vectorSearch on each selected collection.
  Falls back to Mode 1 silently when the index is absent or the API
  call fails.

  Required env vars to enable Mode 2:
    EMBEDDING_MODEL      e.g. "text-embedding-3-small"
    EMBEDDING_API_KEY    defaults to LLM_API_KEY
    EMBEDDING_BASE_URL   defaults to "https://api.openai.com/v1"
    EMBEDDING_FIELD      MongoDB field storing the vector (default "embedding")
    EMBEDDING_INDEX      Atlas vector index name (default "vector_index")
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from llm.client import LLMClient

logger = logging.getLogger("voxa.orchestrator.semantic")

# ── Static domain synonym table ───────────────────────────────────────────────
#
# Maps layman trigger words (lowercase) to exact DB vocabulary + related terms.
# This runs BEFORE the LLM expansion so that common medical/manufacturing terms
# are always resolved — even when the LLM call is slow or rate-limited.
#
# Each value is a list of single-word search terms that regex-match the relevant
# field values in MongoDB (e.g. "diabetes" substring-matches "Type 2 Diabetes
# Mellitus", "cardiac" matches "Cardiology" and cardiac-related diagnoses).

_DOMAIN_SYNONYMS: dict[str, list[str]] = {
    # ── Production — output & KPIs ─────────────────────────────────────────
    "units":         ["total_units_produced", "units_target", "production"],
    "output":        ["total_units_produced", "units_target", "produced"],
    "produced":      ["total_units_produced", "production"],
    "capacity":      ["capacity_utilization_pct", "utilization"],
    "utilization":   ["capacity_utilization_pct", "capacity"],
    "efficiency":    ["capacity_utilization_pct", "on_time_delivery_pct"],
    "delivery":      ["on_time_delivery_pct", "on_time"],
    "issues":        ["open_issues_count"],
    "throughput":    ["total_units_produced", "capacity_utilization_pct"],
    # ── Production — shifts ────────────────────────────────────────────────
    "shift":         ["morning", "afternoon", "night", "shift"],
    "shifts":        ["morning", "afternoon", "night", "shift"],
    "morning":       ["shift", "Morning"],
    "afternoon":     ["shift", "Afternoon"],
    "night":         ["shift", "Night"],
    # ── Production — batches ───────────────────────────────────────────────
    "batch":         ["batch_status", "total_batches", "batches_completed"],
    "batches":       ["batch_status", "total_batches", "batches_completed"],
    "completed":     ["batches_completed", "Completed", "batch_status"],
    "in-progress":   ["batches_in_progress", "In Progress"],
    "pending":       ["batches_pending", "Pending"],
    "on-hold":       ["batches_on_hold", "On Hold"],
    "hold":          ["batches_on_hold", "On Hold"],
    # ── Production — areas ────────────────────────────────────────────────
    "granulation":   ["area_granulation_units", "granulator_speed_rpm"],
    "compression":   ["area_compression_units", "compression_force_kn"],
    "coating":       ["area_coating_units", "coater_inlet_temp_celsius"],
    "packaging":     ["area_packaging_units"],
    "area":          ["area_granulation_units", "area_compression_units", "area_coating_units", "area_packaging_units"],
    # ── Production — equipment parameters ─────────────────────────────────
    "granulator":    ["granulator_speed_rpm", "rpm", "granulation"],
    "rpm":           ["granulator_speed_rpm", "granulator"],
    "coater":        ["coater_inlet_temp_celsius", "temperature"],
    "temperature":   ["coater_inlet_temp_celsius"],
    "humidity":      ["humidity_pct_rh"],
    "pressure":      ["differential_pressure_pa"],
    "toc":           ["water_system_toc_ppb"],
    "water":         ["water_system_toc_ppb"],
    # ── Production — alerts ────────────────────────────────────────────────
    "alert":         ["alert_high_count", "alert_medium_count", "alert_low_count"],
    "alerts":        ["alert_high_count", "alert_medium_count", "alert_low_count"],
    "high":          ["alert_high_count", "high_count"],
    "medium":        ["alert_medium_count"],
    "low":           ["alert_low_count"],
    # ── Production — activities ────────────────────────────────────────────
    "calibration":   ["activity_equipment_calibration_due"],
    "maintenance":   ["activity_preventive_maintenance_due"],
    "changeover":    ["activity_changeover_scheduled"],
    "qc":            ["activity_qc_review_time", "inspection"],
    # ── Quality — inspections ─────────────────────────────────────────────
    "inspection":    ["inspection_result", "inspection_score", "inspection_stage"],
    "inspections":   ["inspection_result", "inspection_score", "inspection_stage"],
    "pass":          ["inspection_result", "Pass"],
    "fail":          ["inspection_result", "Fail"],
    "failed":        ["inspection_result", "Fail"],
    "passed":        ["inspection_result", "Pass"],
    "score":         ["inspection_score", "audit_score_pct"],
    "incoming":      ["inspection_stage", "Incoming"],
    "stability":     ["inspection_stage", "Stability"],
    # ── Quality — deviations ───────────────────────────────────────────────
    "deviation":     ["deviation_severity", "deviation_critical_count", "deviation_major_count", "deviation_minor_count"],
    "deviations":    ["deviation_severity", "deviation_critical_count", "deviation_major_count"],
    "critical":      ["deviation_critical_count", "capa_critical_count", "Critical"],
    "major":         ["deviation_major_count", "capa_major_count", "Major"],
    "minor":         ["deviation_minor_count", "Minor"],
    "defect":        ["deviation_severity", "deviation_critical_count"],
    # ── Quality — NCRs ────────────────────────────────────────────────────
    "ncr":           ["open_ncrs_count"],
    "ncrs":          ["open_ncrs_count"],
    "nonconformance": ["open_ncrs_count", "deviation_severity"],
    "nonconformances": ["open_ncrs_count"],
    # ── Quality — CAPA ────────────────────────────────────────────────────
    "capa":          ["capa_pending_count", "capa_critical_count", "capa_major_count"],
    "capas":         ["capa_pending_count", "capa_critical_count"],
    "corrective":    ["capa_pending_count", "capa_critical_count"],
    "preventive":    ["capa_pending_count", "capa_major_count"],
    # ── Quality — audits ──────────────────────────────────────────────────
    "audit":         ["audit_score_pct", "previous_audit_score_pct"],
    "audits":        ["audit_score_pct", "audit1_name", "audit2_name"],
    "gmp":           ["audit_score_pct", "compliance"],
    "compliance":    ["audit_score_pct", "deviation_severity", "inspection_result"],
    # ── General manufacturing ──────────────────────────────────────────────
    "plant":         ["production", "manufacturing"],
    "manufacturing": ["production", "total_units_produced"],
    "product":       ["product_name"],
    "products":      ["product_name"],
    "quality":       ["inspection_result", "inspection_score", "audit_score_pct"],
    "performance":   ["capacity_utilization_pct", "on_time_delivery_pct", "inspection_score"],
}


def _static_expand(query: str, keywords: list[str]) -> list[str]:
    """
    Inject domain synonyms for any trigger words found in the query or keyword list.
    Checks substrings so 'diabetic cases' → triggers 'diabetic' → injects diabetes terms.
    """
    text = (query + " " + " ".join(keywords)).lower()
    extra: list[str] = []
    for trigger, synonyms in _DOMAIN_SYNONYMS.items():
        if trigger in text:
            extra.extend(synonyms)
    return list(dict.fromkeys(extra))  # deduplicate, preserve order


# ── LLM expansion ─────────────────────────────────────────────────────────────

_EXPAND_SYSTEM = """\
You are a search query expander for a pharmaceutical manufacturing plant analytics database.
The database contains production data (units produced, batch status, shifts, equipment parameters,
alerts, capacity utilization) and quality data (inspection results, deviations, NCRs, CAPAs,
audit scores, product names).

Given a user question, output ONLY a comma-separated list of 5-8 single-word search terms —
synonyms, abbreviations, and pharma/manufacturing domain vocabulary that would help find records.

Rules:
- Single words only (no phrases)
- Do NOT repeat words already in the query
- Do NOT output sentences or explanations
- Cover pharma-specific jargon and field name fragments

Examples:
  Input : "what is the batch completion rate this week"
  Output: completed, batches_completed, total_batches, status, production, finished

  Input : "show inspection failures by product"
  Output: fail, failed, inspection_result, product_name, quality, score

  Input : "how many critical deviations and open NCRs"
  Output: deviation_critical, open_ncrs_count, nonconformance, capa, severity, quality
"""


async def expand_keywords_llm(query: str, llm: LLMClient) -> list[str]:
    """
    Return 5-8 semantically related single-word terms for *query*.
    Returns [] on any failure so the pipeline continues unaffected.
    """
    try:
        raw = llm.complete(
            [
                {"role": "system", "content": _EXPAND_SYSTEM},
                {"role": "user", "content": query},
            ]
        )
        terms = [t.strip().lower() for t in raw.split(",") if t.strip()]
        # Keep only single tokens of useful length
        terms = [t for t in terms if " " not in t and 2 < len(t) <= 30][:8]
        logger.info("Semantic expansion: %d terms for query=%r", len(terms), query[:60])
        return terms
    except Exception as exc:
        logger.warning("LLM keyword expansion failed: %s", exc)
        return []


# ── Embedding vector search ───────────────────────────────────────────────────


def _embedding_client():
    """
    Lazily build an AsyncOpenAI client configured for embedding calls.
    Returns None when EMBEDDING_MODEL is not set.
    """
    import os
    model = os.getenv("EMBEDDING_MODEL")
    if not model:
        return None, None
    try:
        from openai import AsyncOpenAI
        api_key = os.getenv("EMBEDDING_API_KEY") or os.getenv("LLM_API_KEY")
        base_url = os.getenv("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
        return AsyncOpenAI(api_key=api_key, base_url=base_url), model
    except ImportError:
        logger.warning("openai package not installed — vector search disabled")
        return None, None


async def get_query_embedding(query: str) -> Optional[list[float]]:
    """
    Encode *query* as a dense vector using the configured embedding model.
    Returns None when EMBEDDING_MODEL is not set or on any error.
    """
    client, model = _embedding_client()
    if client is None:
        return None
    try:
        response = await client.embeddings.create(model=model, input=query)
        return response.data[0].embedding
    except Exception as exc:
        logger.warning("Embedding API call failed: %s", exc)
        return None


# ── Public helper ─────────────────────────────────────────────────────────────


async def build_search_terms(
    query: str,
    base_keywords: list[str],
    llm: LLMClient,
) -> list[str]:
    """
    Return the merged keyword list: base_keywords + static synonyms + LLM-expanded terms.
    Static expansion runs first so layman medical/manufacturing terms always resolve
    to exact DB vocabulary regardless of LLM availability or rate limits.
    Deduplicates and caps at 15 terms.
    """
    static_extra = _static_expand(query, base_keywords)
    if static_extra:
        logger.debug(
            "Static expansion added %d terms for query=%r: %s",
            len(static_extra), query[:60], static_extra,
        )
    expanded = await expand_keywords_llm(query, llm)
    merged = list(dict.fromkeys(base_keywords + static_extra + expanded))
    return merged[:15]
