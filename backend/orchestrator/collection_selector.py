"""
Collection selector for database-backed questions.

The LLM is useful for semantic routing, but it should not be the only path
between a user question and the database. This module first builds a local
relevance score from collection names, fields, and sample values, then merges
that with the LLM's selection when the provider is available.
"""

import logging
import re

from llm.client import LLMClient

logger = logging.getLogger("voxa.orchestrator.selector")

_SELECTION_SYSTEM = """\
You are a database routing assistant for ANI Pharmaceuticals. Given a user question and a list \
of MongoDB collections with their field names, return the names of the 1-4 collections MOST \
LIKELY to contain the data needed to answer the question.

IMPORTANT: Use the EXACT collection names from the catalog below — do not invent or shorten names.

Rules:
- Return ONLY a comma-separated list of collection names (exactly as they appear in the catalog).
- Choose at most 4 collections.
- If none look relevant, return an empty response.

Domain routing — use the catalog field list to find the right collection:
- Production output, units produced, shifts (Morning/Afternoon/Night), capacity utilization, \
  on-time delivery, batch IDs, batch status (Completed/In Progress/Pending/On Hold), \
  production areas (granulation, compression, coating, packaging), equipment parameters \
  (granulator speed, coater temperature, compression force, humidity, differential pressure, TOC), \
  alerts (high/medium/low), scheduled activities (calibration, maintenance, changeover, QC review) \
  → pick the collection with 'total_units_produced', 'batch_status', or 'shift' fields
- Quality inspections (pass/fail/score), inspection stage (Incoming/In-Process/Stability), \
  deviations (critical/major/minor), NCRs (non-conformance reports), CAPA \
  (corrective and preventive actions), audit scores, upcoming audits, product names, \
  batch quality records \
  → pick the collection with 'inspection_result', 'inspection_score', or 'open_ncrs_count' fields

CRITICAL DISAMBIGUATION — these rules OVERRIDE everything above:
- Query about production volumes, output, units, shifts, capacity, batch runs, equipment parameters, \
  or operational alerts → ALWAYS select the production_dashboard collection.
- Query about inspections, pass/fail rates, deviations, NCRs, CAPAs, audit scores, or product \
  quality compliance → ALWAYS select the quality_dashboard collection.
- Always choose the collection whose name directly matches the primary entity in the question.
"""

_STOP_WORDS = {
    # Articles / prepositions / conjunctions
    "the", "a", "an", "of", "in", "on", "at", "by", "for", "with",
    "and", "or", "not", "to", "from", "into", "about", "over", "after",
    "before", "above", "below", "around", "through", "under", "since",
    "both", "between", "such", "than", "then", "also", "only",
    # Auxiliary / modal verbs
    "is", "are", "was", "were", "be", "been", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may",
    "might", "shall", "must", "can",
    # Pronouns / determiners
    "i", "me", "my", "we", "us", "our", "you", "your", "they",
    "them", "their", "it", "its", "he", "she", "him", "her",
    "that", "this", "these", "those", "who", "whom", "which",
    # Question words
    "what", "how", "when", "where", "why",
    # Generic action / filler verbs
    "show", "give", "tell", "find", "list", "get", "make", "take",
    "come", "see", "know", "like", "just", "need", "want", "help",
    "use", "back", "here", "there", "well", "still", "very", "good",
    "great", "per", "each", "many", "much", "more", "most", "any",
    "some", "all", "few",
    # Meta / dataset words (too generic for routing)
    "data", "dataset", "record", "records", "details", "please",
    # Greetings — must never influence collection scoring
    "hello", "hi", "hey", "howdy", "greetings", "hear", "heard",
    "thanks", "thank", "okay", "sure", "yes", "yeah",
    "alright", "ok", "got", "understood", "fine", "bye", "goodbye",
}


# Maps query words to additional collection-matching terms.
# Handles semantic gaps where heuristic scoring fails because the query uses
# a synonym that doesn't appear in any collection name or field list.
_QUERY_SYNONYMS: dict[str, list[str]] = {
    # Production dashboard terms
    "batch":           ["production", "batch_status", "batches_completed"],
    "batches":         ["production", "batch_status", "total_batches"],
    "shift":           ["production", "morning", "afternoon", "night"],
    "shifts":          ["production", "shift"],
    "granulation":     ["production", "granulator", "area_granulation"],
    "compression":     ["production", "area_compression"],
    "coating":         ["production", "coater", "area_coating"],
    "packaging":       ["production", "area_packaging"],
    "units":           ["production", "total_units_produced", "units_target"],
    "output":          ["production", "total_units_produced"],
    "capacity":        ["production", "capacity_utilization_pct"],
    "utilization":     ["production", "capacity_utilization_pct"],
    "throughput":      ["production", "total_units_produced"],
    "alerts":          ["production", "alert_high_count", "alert_medium_count"],
    "alert":           ["production", "alert_high_count"],
    "maintenance":     ["production", "activity_preventive_maintenance_due"],
    "calibration":     ["production", "activity_equipment_calibration_due"],
    "changeover":      ["production", "activity_changeover_scheduled"],
    "toc":             ["production", "water_system_toc_ppb"],
    "humidity":        ["production", "humidity_pct_rh"],
    # Quality dashboard terms
    "inspection":      ["quality", "inspection_result", "inspection_score"],
    "inspections":     ["quality", "inspection_result"],
    "deviation":       ["quality", "deviation_critical_count", "deviation_severity"],
    "deviations":      ["quality", "deviation_major_count", "deviation_minor_count"],
    "ncr":             ["quality", "open_ncrs_count"],
    "ncrs":            ["quality", "open_ncrs_count"],
    "capa":            ["quality", "capa_pending_count", "capa_critical_count"],
    "capas":           ["quality", "capa_pending_count"],
    "audit":           ["quality", "audit_score_pct", "audit1_name"],
    "audits":          ["quality", "audit_score_pct"],
    "gmp":             ["quality", "audit_score_pct"],
    "compliance":      ["quality", "audit_score_pct"],
    "pass":            ["quality", "inspection_result"],
    "fail":            ["quality", "inspection_result"],
    "defect":          ["quality", "deviation_severity"],
    "nonconformance":  ["quality", "open_ncrs_count"],
    "corrective":      ["quality", "capa_pending_count"],
    "preventive":      ["quality", "capa_pending_count"],
}


def _terms(query: str) -> list[str]:
    tokens = re.findall(r"[a-zA-Z0-9]+", query.lower())
    base = [t for t in tokens if len(t) > 2 and t not in _STOP_WORDS]
    expanded: list[str] = []
    for t in base:
        expanded.append(t)
        for synonym in _QUERY_SYNONYMS.get(t, []):
            if synonym not in expanded:
                expanded.append(synonym)
    return expanded


# Pairs of (query_terms_that_indicate_entity, collection_name_substring_to_exclude).
# When any query term from the first set appears, collections whose name contains
# the exclusion substring are penalised heavily so they cannot win.
_CROSS_ENTITY_EXCLUSIONS: list[tuple[frozenset[str], str]] = [
    # Production-specific queries must not bleed into quality
    (frozenset({"shift", "granulation", "compression", "coating", "granulator",
                "coater", "changeover", "toc"}), "quality"),
    # Quality-specific queries must not bleed into production
    (frozenset({"inspection", "deviation", "ncr", "capa", "audit", "nonconformance",
                "conformance", "corrective", "preventive"}), "production"),
]


def _heuristic_scores(
    query: str,
    collection_metadata: dict[str, dict],
) -> list[tuple[str, int]]:
    terms = _terms(query)
    if not terms:
        return []

    # Determine which collection name substrings are excluded for this query
    excluded_name_substrings: list[str] = []
    for query_signals, exclude_substr in _CROSS_ENTITY_EXCLUSIONS:
        if any(t in query_signals for t in terms):
            excluded_name_substrings.append(exclude_substr)

    scored: list[tuple[str, int]] = []
    for name, meta in collection_metadata.items():
        name_text = name.lower().replace("_", " ")
        fields = meta.get("fields", [])
        searchable = " ".join(
            [
                name_text,
                " ".join(fields),
                " ".join(meta.get("searchable_fields", [])),
                str(meta.get("sample_text", "")),
            ]
        ).lower()

        score = 0
        for term in terms:
            if term in name_text:
                score += 8
            if any(term in field.lower() for field in fields):
                score += 4
            if term in searchable:
                score += 2

        # Apply cross-entity exclusion penalty
        if any(excl in name_text for excl in excluded_name_substrings):
            score -= 1000

        if score > 0:
            scored.append((name, score))

    return sorted(scored, key=lambda item: item[1], reverse=True)


def build_catalog_text(collection_metadata: dict[str, dict]) -> str:
    """Format collection metadata into a readable catalog for the LLM."""
    lines = []
    for name, meta in collection_metadata.items():
        fields = meta.get("fields", [])
        count = meta.get("doc_count", "?")
        field_str = ", ".join(fields[:12]) if fields else "unknown"
        lines.append(f"- {name} ({count} docs): [{field_str}]")
    return "\n".join(lines)


async def select_collections(
    query: str,
    collection_metadata: dict[str, dict],
    llm: LLMClient,
    max_collections: int = 4,
) -> list[str]:
    """
    Pick relevant collections for *query*.

    Local scoring is always available. LLM routing is merged in when it works,
    and the final fallback is top collections by document count.
    """
    if not collection_metadata:
        return []

    heuristic = _heuristic_scores(query, collection_metadata)
    heuristic_names = [name for name, _ in heuristic[:max_collections]]

    catalog = build_catalog_text(collection_metadata)
    messages = [
        {"role": "system", "content": _SELECTION_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Available collections:\n{catalog}\n\n"
                f"User question: {query}\n\n"
                f"Which collections should I query? (comma-separated list)"
            ),
        },
    ]

    try:
        raw = llm.complete(messages).strip()
        chosen = [c.strip().lower() for c in raw.split(",") if c.strip()]
        valid = [c for c in chosen if c in collection_metadata]

        merged: list[str] = []
        for name in valid + heuristic_names:
            if name not in merged:
                merged.append(name)
        if merged:
            selected = merged[:max_collections]
            logger.info(f"Selected collections: {selected}")
            return selected
    except Exception as exc:
        logger.warning(f"LLM collection selection failed: {exc}")

    if heuristic_names:
        logger.info(f"Heuristic collection selection: {heuristic_names}")
        return heuristic_names

    if _terms(query):
        logger.info("No relevant collections matched the request")
        return []

    sorted_by_docs = sorted(
        collection_metadata.keys(),
        key=lambda n: collection_metadata[n].get("doc_count", 0),
        reverse=True,
    )
    fallback = sorted_by_docs[:max_collections]
    logger.info(f"Fallback collection selection: {fallback}")
    return fallback
