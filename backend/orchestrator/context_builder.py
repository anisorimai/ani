"""
Context builder — serialises fetched MongoDB data or analytics results into a text block
that the LLM can reason over.
"""

import json
import logging
import re
from typing import Any

logger = logging.getLogger("voxa.orchestrator.context")

# Fields stripped from every record before it reaches the LLM.
_STRIP_FIELDS = frozenset({"_id", "embedding", "__v"})


def _clean_record(doc: dict) -> dict:
    """Remove internal fields, large arrays, and null-valued fields from records."""
    return {
        k: v for k, v in doc.items()
        if k not in _STRIP_FIELDS
        and not (isinstance(v, list) and len(v) > 20)
        and v is not None
    }

# Maximum characters for the entire data context block.
# llama-3.3-70b-versatile has a 131,072-token context window (~524K chars).
# 150K chars (~37K tokens) leaves ample room for the system prompt, history,
# and a full response while keeping per-request token cost reasonable.
MAX_CONTEXT_CHARS = 150_000
# Maximum characters for the data context passed to the LLM
MAX_CONTEXT_CHARS = 80_000


def _filter_to_readable(filter_dict: dict) -> str:
    """Convert a MongoDB filter dict to a brief plain-English description."""
    if not filter_dict:
        return ""
    parts: list[str] = []
    for field, condition in filter_dict.items():
        label = field.replace("_", " ")
        if isinstance(condition, dict):
            if "$regex" in condition:
                val = re.sub(r"[\^\$]", "", condition["$regex"])
                parts.append(f"{label} = {val}")
            elif "$gt" in condition:
                parts.append(f"{label} > {condition['$gt']}")
            elif "$gte" in condition:
                parts.append(f"{label} ≥ {condition['$gte']}")
            elif "$lt" in condition:
                parts.append(f"{label} < {condition['$lt']}")
            elif "$lte" in condition:
                parts.append(f"{label} ≤ {condition['$lte']}")
            elif "$in" in condition:
                vals = ", ".join(str(v) for v in condition["$in"][:5])
                parts.append(f"{label} in [{vals}]")
            else:
                parts.append(label)
        else:
            parts.append(f"{label} = {condition}")
    return "; ".join(parts)


def build_analytics_context(analytics_results: dict[str, Any]) -> str:
    """
    Format structured aggregation results (from analytics_executor) into LLM-readable text.
    Each collection's computed metrics are listed clearly.
    """
    sections: list[str] = []
    _OP_LABELS = {"avg": "Average", "sum": "Total", "max": "Highest", "min": "Lowest"}

    for collection, data in analytics_results.items():
        applied_filter = data.get("filter") or {}
        readable_filter = _filter_to_readable(applied_filter)
        collection_label = collection.replace("_", " ").title()
        scope_note = f" (where {readable_filter})" if readable_filter else ""
        lines: list[str] = [f"[{collection_label}{scope_note}]"]

        if "count" in data:
            label = "Matching records" if applied_filter else "Total records"
            lines.append(f"{label}: {data['count']:,}")
            if applied_filter and "total_count" in data:
                total = data["total_count"]
                if total != data["count"]:
                    lines.append(f"Total in collection (unfiltered): {total:,}")

        # --- Combined per-group breakdown with metric values ---
        # Rendered BEFORE the global aggregates so the LLM reads per-group figures
        # first and doesn't confuse a global average with a per-group average.
        if "group_by_metrics" in data:
            gbm = data["group_by_metrics"]
            field_label = gbm["field"].replace("_", " ").title()
            op_keys: list[str] = gbm.get("ops", [])

            # Build a human-readable header describing what each column contains
            col_descriptions: list[str] = []
            for key in op_keys:
                parts = key.split("_", 1)
                if len(parts) == 2:
                    op_lbl = _OP_LABELS.get(parts[0], parts[0].upper())
                    fld_lbl = parts[1].replace("_", " ").title()
                    col_descriptions.append(f"{op_lbl} {fld_lbl}")
            header_cols = ", ".join(col_descriptions) if col_descriptions else "metric values"
            lines.append(f"Breakdown by {field_label} ({header_cols} per group):")

            lines.append(
                "  (NOTE: 'records' = number of DB documents in that group, "
                "NOT the metric value. Read the metric columns for the actual figures.)"
            )
            for row in gbm["rows"][:100]:
                row_parts: list[str] = [f"{row['value']}: {row['count']:,} records"]
                for key in op_keys:
                    val = row.get(key, None)  # None when key absent or explicitly null
                    parts = key.split("_", 1)
                    op_lbl = _OP_LABELS.get(parts[0], parts[0].upper()) if len(parts) == 2 else key
                    fld_lbl = parts[1].replace("_", " ").title() if len(parts) == 2 else ""
                    if val is None:
                        row_parts.append(f"{op_lbl} {fld_lbl} = N/A (no data)")
                    elif isinstance(val, float):
                        row_parts.append(f"{op_lbl} {fld_lbl} = {val:,.2f}")
                    elif isinstance(val, int):
                        row_parts.append(f"{op_lbl} {fld_lbl} = {val:,}")
                    else:
                        row_parts.append(f"{op_lbl} {fld_lbl} = {val}")
                lines.append("  " + " | ".join(row_parts))

        # --- Pure count breakdown (no metric, only when group_by_metrics is absent) ---
        elif "group_by" in data:
            gb = data["group_by"]
            field_label = gb["field"].replace("_", " ").title()
            lines.append(f"Breakdown by {field_label} (record count per group):")
            for item in gb["counts"][:100]:
                lines.append(f"  {item['value']}: {item['count']:,} records")

        # --- Global / overall numeric aggregates ---
        # Labeled as "Overall" when a per-group breakdown already exists so the
        # LLM does not mistake the global figure for a per-group value.
        has_group_breakdown = "group_by_metrics" in data or "group_by" in data
        for key, val in data.items():
            if key.startswith(("avg_", "sum_", "max_", "min_")):
                op, field = key.split("_", 1)
                op_label = _OP_LABELS.get(op, op.upper())
                field_label = field.replace("_", " ").title()
                if isinstance(val, float):
                    val_str = f"{val:,.2f}"
                elif isinstance(val, int):
                    val_str = f"{val:,}"
                else:
                    val_str = str(val)
                prefix = "Overall " if has_group_breakdown else ""
                lines.append(f"{prefix}{op_label} {field_label}: {val_str}")

        for metric in data.get("derived_metrics", []) or []:
            label = metric.get("label", "Derived Metric")
            pct = metric.get("percentage")
            matched = metric.get("matched_count")
            total = metric.get("total_count")
            field = metric.get("field")
            if isinstance(pct, (int, float)) and isinstance(matched, int) and isinstance(total, int):
                field_note = f" from {field}" if field else ""
                lines.append(
                    f"{label}: {pct:,.2f}% ({matched:,} of {total:,} records{field_note})"
                )

        for rec_key in ("top_records", "bottom_records"):
            if rec_key in data and data[rec_key]:
                label = "Top ranked records:" if rec_key == "top_records" else "Bottom ranked records:"
                lines.append(label)
                for i, rec in enumerate(data[rec_key], 1):
                    cleaned_rec = _clean_record(rec) if isinstance(rec, dict) else rec
                    lines.append(f"  #{i}: {json.dumps(cleaned_rec, default=str)}")

        sections.append("\n".join(lines))

    return "\n\n".join(sections)


def build_context(
    fetched: dict[str, dict[str, Any]],
    page: int = 1,
    page_size: int = 50,
    max_chars: int = MAX_CONTEXT_CHARS,
) -> str:
    """
    Convert the {collection_name: {samples, total_count, …}} dict into a readable text block.
    Includes pagination metadata in the header when applicable.
    """
    sections: list[str] = []

    for name, payload in fetched.items():
        if not payload:
            continue

        samples: list[dict] = []
        total: int = 0
        total_matching: int = 0

        if isinstance(payload, dict):
            samples = payload.get("samples", [])
            total = payload.get("total_count", len(samples))
            # matching_count = exact count of records matching the query filter.
            # This may be larger than len(samples) when results were capped before
            # serialisation. Always report this so the LLM knows the real total.
            matching_count = payload.get("matching_count", len(samples))
            # Include pre-computed aggregations if present
            total_matching = payload.get("total_matching", total)
            aggs = payload.get("aggregations")
            if aggs:
                try:
                    # Strip entries where _id is null — they represent records with no
                    # value for the grouping field and add noise / "None" rows to the LLM.
                    filtered_aggs = [a for a in aggs if a.get("_id") is not None]
                    if filtered_aggs:
                        agg_text = json.dumps(filtered_aggs, default=str, ensure_ascii=False)
                        sections.append(f"[{name} — aggregations]\n{agg_text}")
                except Exception:
                    pass
        elif isinstance(payload, list):
            samples = payload
            total = len(samples)
            matching_count = len(samples)
            total_matching = total

        if not samples:
            continue

        total_pages = max(1, -(-total_matching // page_size))  # ceiling division
        cleaned = [_clean_record(s) if isinstance(s, dict) else s for s in samples]
        try:
            rows = json.dumps(cleaned, default=str, ensure_ascii=False, indent=None)
        except Exception:
            rows = str(cleaned)

        collection_label = name.replace("_", " ").title()
        if matching_count > len(samples):
            header = (
                f"[{collection_label}]  ({matching_count} records found out of "
                f"{total} total — showing {len(samples)} below, "
                f"page {page} of {total_pages})"
            )
        else:
            header = f"[{collection_label}]  ({matching_count} records)"
        sections.append(f"{header}\n{rows}")

    full_context = "\n\n".join(sections)

    if len(full_context) > max_chars:
        full_context = (
            full_context[:max_chars]
            + "\n\n[DATA TRUNCATED — token budget reached. "
            "Records above may be incomplete. "
            "Do NOT complete, infer, or extrapolate any values cut off above this line. "
            "Only report what appears in full before this marker.]"
        )

    return full_context


def build_merged_context(chunks: list[dict], fetched: dict) -> str:
    """
    Combine RAG document chunks and DB records under explicit section headers
    so the LLM can unambiguously tell which data came from uploaded documents
    and which came from the structured database — without hardcoding any
    query-specific routing logic.

    Layout:
      === UPLOADED DOCUMENTS ===
      [DOCUMENT: filename — chunk N]
      <chunk text>

      === DATABASE RECORDS ===
      [collection]  (N records)
      [...]
    """
    rag_part = build_rag_context(chunks, max_chars=8_000)
    db_part  = build_context(fetched)

    sections: list[str] = []
    if rag_part:
        sections.append("=== UPLOADED DOCUMENTS ===\n" + rag_part)
    if db_part:
        sections.append("=== DATABASE RECORDS ===\n" + db_part)
    return "\n\n".join(sections)


def build_rag_only_context(chunks: list[dict]) -> str:
    """
    Format RAG chunks as the *sole* context source (no DB data alongside).
    Uses a larger character budget than build_rag_context() because there is no
    competing DB context to share the token budget with.
    """
    return build_rag_context(chunks, max_chars=16_000)


def build_rag_context(chunks: list[dict], max_chars: int = 8_000) -> str:
    """
    Render retrieved RAG chunks as a text block for the LLM.

    Each chunk is formatted as:
      [DOCUMENT: filename.pdf — chunk 3]
      <chunk text>

    Kept visually distinct from structured DB data so the LLM can attribute sources.
    The max_chars budget is separate from MAX_CONTEXT_CHARS — RAG chunks have their
    own truncation point so one large document doesn't crowd out structured DB results.
    """
    if not chunks:
        return ""

    parts: list[str] = []
    total_chars = 0

    for chunk in chunks:
        filename    = chunk.get("filename", "unknown")
        chunk_index = chunk.get("chunk_index", 0)
        text        = chunk.get("text", "").strip()

        if not text:
            continue

        equipment = chunk.get("equipment")
        if equipment and equipment != "General":
            header  = f"[DOCUMENT: {filename} — Equipment: {equipment} — chunk {chunk_index}]"
        else:
            header  = f"[DOCUMENT: {filename} — chunk {chunk_index}]"
        section = f"{header}\n{text}"

        if total_chars + len(section) > max_chars:
            remaining = max_chars - total_chars
            if remaining > 100:
                parts.append(
                    section[:remaining]
                    + "\n[TRUNCATED — do not complete or infer the rest of this passage]"
                )
            break

        parts.append(section)
        total_chars += len(section)

    return "\n\n".join(parts)
