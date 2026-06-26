"""
Analytics Executor — runs targeted MongoDB aggregations instead of raw document fetching.

Used by the orchestrator for analytics and comparison queries to return exact,
deterministic, hallucination-free metric values directly from the database.
"""

from __future__ import annotations

import logging
import re as _re
from typing import Any, Optional

from orchestrator.date_utils import find_date_field, resolve_time_range_to_filter
from orchestrator.query_normalizer import QueryMeta
from repositories.generic_repository import GenericRepository

logger = logging.getLogger("voxa.orchestrator.analytics")

# Field suffixes that indicate string ID / non-numeric fields — skip for sum/avg/max/min
_ID_SUFFIXES = ("_id", ".id", "_number", "_code", "_key", "_hash", "_token")

# Boolean adjective → boolean value mapping.
# When a filter value is one of these words, look for an is_<value> boolean field first.
# e.g.  filters={"status": "active"}  →  {"is_active": True}
_ACTIVE_ADJECTIVES: dict[str, bool] = {
    "active": True,
    "inactive": False,
    "enabled": True,
    "disabled": False,
    "open": True,
    "closed": False,
}

# Negative adjectives whose positive counterpart is stored in MongoDB as is_<positive>.
# e.g. "inactive" → no is_inactive field → try is_active: False instead.
_NEGATIVE_TO_POSITIVE: dict[str, str] = {
    "inactive": "active",
    "disabled": "enabled",
    "closed": "open",
}


# ── Field resolution ──────────────────────────────────────────────────────────

def _resolve_field(name: str, fields: list[str]) -> Optional[str]:
    """
    Fuzzy-match a filter key or metric name to an actual collection field.

    Resolution order (first match wins):
      1. Exact case-insensitive match          "status" → "status"
      2. Normalised match (strip _ and spaces) "is_active" → "isactive"
      3. Substring containment                 "active" → "is_active"
      4. 6-char prefix overlap (min 6 to avoid "state"↔"status" false positive)
    """
    if not name or not fields:
        return None
    name_norm = name.lower().replace("_", "").replace(" ", "")

    # 1. Exact
    for f in fields:
        if f.lower() == name.lower():
            return f

    # 2. Normalised exact
    for f in fields:
        if f.lower().replace("_", "").replace(" ", "") == name_norm:
            return f

    # 3. Substring — handles "active" → "is_active", "registered" → "registered_at"
    if len(name_norm) >= 4:
        for f in fields:
            f_norm = f.lower().replace("_", "").replace(" ", "")
            if name_norm in f_norm or f_norm in name_norm:
                return f

    # 4. Prefix overlap — require ≥6 chars to avoid short-word false positives
    #    e.g. "status"[:6]="status" vs "state"[:6]="state"  → no match (correct)
    if len(name_norm) >= 6:
        for f in fields:
            f_norm = f.lower().replace("_", "").replace(" ", "")
            if len(f_norm) >= 6 and (
                f_norm.startswith(name_norm[:6]) or name_norm.startswith(f_norm[:6])
            ):
                return f

    return None


def _is_numeric_field(field_name: str) -> bool:
    """Return False for obvious ID / string-type fields that should not be aggregated numerically."""
    fl = field_name.lower()
    return not any(fl.endswith(s) for s in _ID_SUFFIXES)


def _coerce_value(value: Any) -> Any:
    """Coerce string filter values to appropriate Python types."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        v = value.lower()
        if v in ("true", "yes", "1"):
            return True
        if v in ("false", "no", "0"):
            return False
        try:
            return int(value)
        except ValueError:
            pass
        try:
            return float(value)
        except ValueError:
            pass
    return value


def _build_mongo_filter(query_filters: dict, fields: list[str]) -> dict:
    """
    Build a MongoDB filter dict by resolving query filter keys to real field names.

    Special handling:
    - Boolean adjectives ("active", "inactive", …) map to is_<adjective> boolean fields
      when available (e.g. filters={"status":"active"} → {"is_active": True}).
    - String values use partial case-insensitive regex so "maintenance" matches
      "UNDER_MAINTENANCE".  ID-like fields (ending in _id/_number/_code) keep exact match.
    """
    if not query_filters:
        return {}
    fields_lower = {f.lower(): f for f in fields}
    resolved: dict = {}

    for key, value in query_filters.items():
        # ── Boolean adjective shortcut ────────────────────────────────────────
        # "status"="active"   → look for is_active: True
        # "status"="inactive" → look for is_inactive: True first, then is_active: False
        if isinstance(value, str) and value.lower() in _ACTIVE_ADJECTIVES:
            bool_field_name = f"is_{value.lower()}"
            if bool_field_name in fields_lower:
                resolved[fields_lower[bool_field_name]] = _ACTIVE_ADJECTIVES[value.lower()]
                continue
            # Negative adjective: try the positive counterpart field with False
            positive = _NEGATIVE_TO_POSITIVE.get(value.lower())
            if positive:
                pos_field = f"is_{positive}"
                if pos_field in fields_lower:
                    resolved[fields_lower[pos_field]] = False
                    continue

        field = _resolve_field(key, fields)
        if not field:
            continue

        coerced = _coerce_value(value)
        if isinstance(coerced, str):
            # ID-like fields: keep exact match to avoid cross-ID collisions
            if any(field.lower().endswith(s) for s in ("_id", "_number", "_code")):
                resolved[field] = {"$regex": f"^{_re.escape(coerced)}$", "$options": "i"}
            else:
                # Partial (contains) match so "maintenance" hits "UNDER_MAINTENANCE",
                # "passed" hits "Passed", etc.
                resolved[field] = {"$regex": _re.escape(coerced), "$options": "i"}
        else:
            resolved[field] = coerced

    return resolved


# ── Aggregation helpers ───────────────────────────────────────────────────────

async def _group_by_count(
    repo: GenericRepository,
    collection: str,
    field: str,
    mongo_filter: dict,
) -> list[dict]:
    """Group documents by field and count each value. Atlas-free-tier safe."""
    try:
        pipeline: list[dict] = [
            {"$match": mongo_filter or {}},
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 100},
        ]
        docs = await repo.aggregate(collection, pipeline)
        return [
            {"value": str(d["_id"]), "count": d["count"]}
            for d in docs
            if d["_id"] is not None
        ]
    except Exception as exc:
        logger.debug("[ANALYTICS] $group failed (%s) — falling back to distinct+count", exc)
        try:
            distinct_values = await repo._db[collection].distinct(field, mongo_filter or {})
            grouped = []
            for val in distinct_values[:50]:
                if val is None:
                    continue
                f = {**mongo_filter, field: val}
                count = await repo.count(collection, f)
                grouped.append({"value": str(val), "count": count})
            return sorted(grouped, key=lambda x: -x["count"])
        except Exception as e2:
            logger.warning("[ANALYTICS] distinct+count also failed: %s", e2)
            return []


async def _numeric_agg(
    repo: GenericRepository,
    collection: str,
    field: str,
    op: str,
    mongo_filter: dict,
) -> Optional[float]:
    """Compute avg/sum/max/min on a numeric field."""
    try:
        pipeline: list[dict] = [
            {"$match": mongo_filter or {}},
            {"$group": {"_id": None, "result": {f"${op}": f"${field}"}}},
        ]
        docs = await repo.aggregate(collection, pipeline)
        if docs and "result" in docs[0] and docs[0]["result"] is not None:
            r = docs[0]["result"]
            return round(float(r), 2) if isinstance(r, float) else r
    except Exception as exc:
        logger.debug("[ANALYTICS] numeric agg %s(%s) failed: %s", op, field, exc)
    return None


async def _top_n_by_field(
    repo: GenericRepository,
    collection: str,
    sort_field: str,
    op: str,           # "max" or "min"
    mongo_filter: dict,
    n: int = 5,
) -> list[dict]:
    """Return top-N documents sorted by sort_field (max → descending, min → ascending)."""
    try:
        direction = -1 if op == "max" else 1
        pipeline: list[dict] = [
            {"$match": mongo_filter or {}},
            {"$sort": {sort_field: direction}},
            {"$limit": n},
        ]
        docs = await repo.aggregate(collection, pipeline)
        return [
            {k: v for k, v in doc.items() if k != "_id" and k != "embedding"}
            for doc in docs
        ]
    except Exception as exc:
        logger.debug("[ANALYTICS] top_n_by_field failed: %s", exc)
        return []


async def _group_by_metric(
    repo: GenericRepository,
    collection: str,
    group_field: str,
    metric_field_ops: list[tuple[str, str]],
    mongo_filter: dict,
) -> list[dict]:
    """
    Combined group-by + metric aggregation in a single MongoDB pipeline.

    Computes count AND all requested metric aggregations (avg/sum/max/min) per
    group value in one round-trip.  This avoids the double-division error that
    occurs when a global average is divided again by the number of groups.

    Returns a list of dicts: [{value, count, "<op>_<field>": value, ...}, ...]
    sorted by count descending.
    """
    group_expr: dict[str, Any] = {
        "_id": f"${group_field}",
        "count": {"$sum": 1},
    }
    for op, field in metric_field_ops:
        mongo_op = f"${op}"
        group_expr[f"{op}_{field}"] = {mongo_op: f"${field}"}

    pipeline: list[dict] = [
        {"$match": mongo_filter or {}},
        {"$group": group_expr},
        {"$sort": {"count": -1}},
        {"$limit": 100},
    ]
    try:
        docs = await repo.aggregate(collection, pipeline)
        rows: list[dict] = []
        for d in docs:
            if d.get("_id") is None:
                continue
            row: dict[str, Any] = {"value": str(d["_id"]), "count": d["count"]}
            for op, field in metric_field_ops:
                key = f"{op}_{field}"
                if key in d:
                    raw = d[key]
                    # Include None explicitly so context_builder can render "N/A"
                    # instead of omitting the metric and letting the LLM confuse
                    # the record count with the metric value.
                    row[key] = (round(float(raw), 2) if isinstance(raw, float) else raw) if raw is not None else None
                else:
                    row[key] = None
            rows.append(row)
        logger.info(
            "[ANALYTICS] _group_by_metric: collection=%s group=%s ops=%s rows=%d",
            collection, group_field,
            [f"{op}_{f}" for op, f in metric_field_ops],
            len(rows),
        )
        return rows
    except Exception as exc:
        logger.debug("[ANALYTICS] _group_by_metric failed: %s", exc)
        return []


# ── Main entry point ─────────────────────────────────────────────────────────

async def run_analytics(
    query_meta: QueryMeta,
    collection_names: list[str],
    metadata: dict,
    repo: GenericRepository,
    top_n: int = 5,
) -> dict[str, Any]:
    """
    Execute targeted DB aggregations for analytics/comparison queries.

    Returns a dict keyed by collection name, each containing computed results
    (counts, group-by distributions, numeric aggregates) ready for
    context_builder.build_analytics_context().
    Always returns a dict (never raises) so callers' asyncio.gather stays safe.
    """
    try:
        return await _run_analytics_inner(query_meta, collection_names, metadata, repo, top_n)
    except Exception as exc:
        logger.error("[ANALYTICS] run_analytics failed: %s", exc)
        return {}


async def _run_analytics_inner(
    query_meta: QueryMeta,
    collection_names: list[str],
    metadata: dict,
    repo: GenericRepository,
    top_n: int = 5,
) -> dict[str, Any]:
    ops = set(query_meta.aggregations or [])
    results: dict[str, Any] = {}

    for collection in collection_names:
        coll_meta = metadata.get(collection, {})
        all_fields = coll_meta.get("fields", [])

        mongo_filter = _build_mongo_filter(query_meta.filters, all_fields)

        # Merge time-range filter so all aggregations are scoped to the requested period.
        time_filter: dict = {}
        if getattr(query_meta, "time_range", None):
            _date_field = find_date_field(all_fields)
            if _date_field:
                time_filter = resolve_time_range_to_filter(query_meta.time_range, _date_field)
                if time_filter:
                    logger.info(
                        "[ANALYTICS] time_range=%r → %s", query_meta.time_range, time_filter
                    )

        combined_filter = {**mongo_filter, **time_filter}
        coll_results: dict[str, Any] = {"filter": combined_filter}

        # --- COUNT ---
        if not ops or "count" in ops:
            count = await repo.count(collection, combined_filter or None)
            coll_results["count"] = count
            logger.info("[ANALYTICS] %s count=%d filter=%s", collection, count, combined_filter)
            if combined_filter:
                total_count = await repo.count(collection, None)
                coll_results["total_count"] = total_count
                logger.info("[ANALYTICS] %s total_count=%d", collection, total_count)

        # --- GROUP BY (with optional per-group metric aggregation) ---
        # When numeric ops (avg/sum/max/min) are also requested alongside group_by,
        # run a single combined $group pipeline that computes count AND metric values
        # per group.  This prevents the double-division bug where a global average
        # is incorrectly divided again by the number of distinct group values.
        if "group_by" in ops and query_meta.grouping:
            resolved_gb = _resolve_field(query_meta.grouping, all_fields)
            if resolved_gb:
                numeric_ops_present = [o for o in ["avg", "sum", "max", "min"] if o in ops]
                metric_field_ops: list[tuple[str, str]] = []
                seen: set[tuple[str, str]] = set()
                for op in numeric_ops_present:
                    for metric in (query_meta.metrics or []):
                        rf = _resolve_field(metric, all_fields)
                        if rf and _is_numeric_field(rf) and (op, rf) not in seen:
                            metric_field_ops.append((op, rf))
                            seen.add((op, rf))

                if metric_field_ops:
                    # Combined aggregation: per-group count + metric values in one pipeline
                    rows = await _group_by_metric(
                        repo, collection, resolved_gb, metric_field_ops, combined_filter
                    )
                    if rows:
                        coll_results["group_by_metrics"] = {
                            "field": resolved_gb,
                            "ops": [f"{op}_{rf}" for op, rf in metric_field_ops],
                            "rows": rows,
                        }
                        logger.info(
                            "[ANALYTICS] %s group_by_metrics field=%s rows=%d",
                            collection, resolved_gb, len(rows),
                        )
                    else:
                        # Fall back to plain count per group if combined agg returns nothing
                        counts = await _group_by_count(repo, collection, resolved_gb, combined_filter)
                        coll_results["group_by"] = {"field": resolved_gb, "counts": counts}
                else:
                    # No numeric metrics — pure count breakdown per group
                    counts = await _group_by_count(repo, collection, resolved_gb, combined_filter)
                    coll_results["group_by"] = {"field": resolved_gb, "counts": counts}
                    logger.info(
                        "[ANALYTICS] %s group_by=%s values=%d", collection, resolved_gb, len(counts)
                    )

        # --- GLOBAL NUMERIC AGGREGATIONS (avg / sum) ---
        # Always compute global totals/averages as a supplementary overall figure,
        # even when group_by_metrics is present (the global total is distinct from per-group).
        for op in ["avg", "sum"]:
            if op in ops:
                for metric in (query_meta.metrics or []):
                    resolved_field = _resolve_field(metric, all_fields)
                    if resolved_field and _is_numeric_field(resolved_field):
                        val = await _numeric_agg(
                            repo, collection, resolved_field, op, combined_filter
                        )
                        if val is not None:
                            coll_results[f"{op}_{resolved_field}"] = val
                            logger.info(
                                "[ANALYTICS] %s %s(%s)=%s", collection, op, resolved_field, val
                            )

        # --- MAX / MIN ---
        # top_n records are only fetched when no group_by is active: returning
        # individual records alongside per-group results confuses the LLM into
        # mixing document-level extremes with group-level summaries.
        has_group_by = bool("group_by" in ops and query_meta.grouping)
        for op in ["max", "min"]:
            if op in ops:
                for metric in (query_meta.metrics or []):
                    resolved_field = _resolve_field(metric, all_fields)
                    if resolved_field and _is_numeric_field(resolved_field):
                        scoped_val = await _numeric_agg(
                            repo, collection, resolved_field, op, combined_filter
                        )
                        if scoped_val is not None:
                            coll_results[f"{op}_{resolved_field}"] = scoped_val
                            logger.info(
                                "[ANALYTICS] %s %s(%s)=%s filter=%s",
                                collection, op, resolved_field, scoped_val, combined_filter,
                            )
                        # Only attach top_n records when no grouping is requested
                        if not has_group_by:
                            top_docs = await _top_n_by_field(
                                repo, collection, resolved_field, op, combined_filter, n=top_n
                            )
                            if top_docs:
                                key = "top_records" if op == "max" else "bottom_records"
                                coll_results[key] = top_docs

        results[collection] = coll_results

    return results

