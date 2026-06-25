"""
Dynamic, context-aware system prompt builder.

Instead of a single static prompt, this module assembles the system message
at runtime by combining:
  - base identity + guardrails  (always present)
  - retrieval preamble          (what data was found and where)
  - serialised data context     (the actual records)
  - intent-specific suffix      (analytics / comparison / forecasting / summary)
  - low-confidence caveat       (when retrieval confidence is marginal)
  - current timestamp

The retrieval preamble is the key improvement over a static prompt — it tells
the LLM exactly what it received so it can focus its reasoning:

  "The query returned 14 records from: production_logs, quality_alerts.
   Time period: April 2026. Key entities: Plant-A.
   Focus: compute or summarize output_volume, defect_rate."
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from prompts.base import BASE_IDENTITY, GUARDRAILS, LOW_CONFIDENCE_CAVEAT
from prompts.suffixes import BY_INTENT


@dataclass
class PromptContext:
    """All runtime information needed to build an intent-aware system prompt."""
    intent: str = "data_query"
    data_context: str = ""
    has_results: bool = True
    low_confidence: bool = False
    user_query: str = ""          # the original user question — injected into the preamble
    # from QueryMeta
    metrics: list[str] = field(default_factory=list)
    entities: list[str] = field(default_factory=list)
    time_range: Optional[str] = None
    aggregations: list[str] = field(default_factory=list)
    has_filters: bool = False     # True when structured filters (e.g. gender=male) were applied
    # from fetched data
    collections: list[str] = field(default_factory=list)
    doc_counts: dict[str, int] = field(default_factory=dict)   # {collection: matching_count}
    total_counts: dict[str, int] = field(default_factory=dict) # {collection: total_collection_count}
    scope_restriction: str = ""   # injected when operating in a scoped dashboard (e.g. production)


def _retrieval_preamble(ctx: PromptContext) -> str:
    """
    One-paragraph summary of what was retrieved, injected before the raw data.

    Example output (with filter):
      "User question: Show me male patients.
       Filters applied — 10,000 matching records found (out of 25,000 total) from: patients.
       Focus: answer from the filtered subset only."

    Example output (no filter):
      "User question: Which hospital has the most diabetic patients?
       The query returned 22 records from: patients, diagnoses.
       Time period: Q1 2026. Key entities: diabetes.
       Focus: compute count grouped by hospital."
    """
    matching = sum(ctx.doc_counts.values()) if ctx.doc_counts else 0
    collection_total = sum(ctx.total_counts.values()) if ctx.total_counts else matching
    if not ctx.has_results or matching == 0:
        return ""

    parts: list[str] = []

    if ctx.user_query:
        parts.append(f'User question: "{ctx.user_query}"')

    coll_str = ", ".join(ctx.collections) if ctx.collections else "the database"
    if ctx.has_filters and matching > 0:
        parts.append(
            f"The database applied the requested filter and found exactly {matching:,} "
            f"matching records from: {coll_str}."
        )
        parts.append(
            f"CRITICAL: {matching:,} IS the direct answer to this query. "
            f"Do not treat it as a total from which you compute a subset. "
            f"Do not estimate or report any other number."
        )
        if collection_total > matching:
            parts.append(f"(The unfiltered collection has {collection_total:,} total records.)")
    else:
        parts.append(f"The query returned {matching:,} records from: {coll_str}.")

    if ctx.time_range:
        parts.append(f"Time period: {ctx.time_range}.")

    if ctx.entities:
        parts.append(f"Key entities: {', '.join(ctx.entities[:5])}.")

    focus = _intent_focus(ctx)
    if focus:
        parts.append(f"Focus: {focus}")

    return " ".join(parts)


def _intent_focus(ctx: PromptContext) -> str:
    if ctx.intent == "analytics":
        if ctx.metrics:
            readable = ", ".join(m.replace("_", " ") for m in ctx.metrics[:3])
            return f"present the {readable} values from the data above."
        return "present all computed metrics and totals clearly."
    if ctx.intent == "comparison":
        return "highlight differences and percentage changes between the groups."
    if ctx.intent == "forecasting":
        return "identify trends in the data and discuss likely future expectations."
    if ctx.intent == "summary":
        return "give a concise executive overview of the most important figures."
    if ctx.metrics:
        readable = ", ".join(m.replace("_", " ") for m in ctx.metrics[:3])
        return f"present the {readable} information clearly."
    return ""


def build_system_prompt(ctx: PromptContext) -> str:
    """Assemble the full, context-aware system prompt from a PromptContext."""
    parts = [BASE_IDENTITY.strip()]

    if GUARDRAILS:
        parts.append("--- GUARDRAILS ---")
        parts.extend(f"- {r}" for r in GUARDRAILS)

    if ctx.scope_restriction:
        parts.append(f"--- SCOPE RESTRICTION ---\n{ctx.scope_restriction}")

    if ctx.data_context.strip():
        preamble = _retrieval_preamble(ctx)
        if preamble:
            parts.append(f"--- RETRIEVAL CONTEXT ---\n{preamble}")
        parts.append(f"--- DATA CONTEXT ---\n{ctx.data_context}\n--- END DATA CONTEXT ---")

    suffix = BY_INTENT.get(ctx.intent, "")
    if suffix:
        parts.append(suffix)

    if ctx.low_confidence:
        parts.append(LOW_CONFIDENCE_CAVEAT)

    parts.append(f"Current date/time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S (%A)')}")

    return "\n\n".join(parts)
