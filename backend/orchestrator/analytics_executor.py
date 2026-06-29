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

_DATE_DEDUP_CACHE: dict[str, bool] = {}
_DATE_LEVEL_FIELD_CACHE: dict[tuple[str, str], bool] = {}

_ID_SUFFIXES = ("_id", ".id", "_number", "_code", "_key", "_hash", "_token")

_ACTIVE_ADJECTIVES: dict[str, bool] = {
    "active": True,
    "inactive": False,
    "enabled": True,
    "disabled": False,
    "open": True,
    "closed": False,
}

_NEGATIVE_TO_POSITIVE: dict[str, str] = {
    "inactive": "active",
    "disabled": "enabled",
    "closed": "open",
}


def _resolve_field(name: str, fields: list[str]) -> Optional[str]:
    if not name or not fields:
        return None
    name_norm = name.lower().replace("_", "").replace(" ", "")

    for f in fields:
        if f.lower() == name.lower():
            return f

    for f in fields:
        if f.lower().replace("_", "").replace(" ", "") == name_norm:
            return f

    if len(name_norm) >= 4:
        for f in fields:
            f_norm = f.lower().replace("_", "").replace(" ", "")
            if name_norm in f_norm or f_norm in name_norm:
                return f

    if len(name_norm) >= 6:
        for f in fields:
            f_norm = f.lower().replace("_", "").replace(" ", "")
            if len(f_norm) >= 6 and (
                f_norm.startswith(name_norm[:6]) or name_norm.startswith(f_norm[:6])
            ):
                return f
    return None

def _is_numeric_field(field_name: str) -> bool:
    fl = field_name.lower()
    return not any(fl.endswith(s) for s in _ID_SUFFIXES)

def _coerce_value(value: Any) -> Any:
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
    if not query_filters:
        return {}
    fields_lower = {f.lower(): f for f in fields}
    resolved: dict = {}

    for key, value in query_filters.items():
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

async def _group_by_count(
    repo: GenericRepository,
    collection: str,
    field: str,
    mongo_filter: dict,
) -> list[dict]:
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
    op: str,
    mongo_filter: dict,
    n: int = 5,
) -> list[dict]:
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

async def _group_by_metric_date_deduped(
    repo: GenericRepository,
    collection: str,
    group_field: str,
    date_field: str,
    metric_field_ops: list[tuple[str, str]],
    mongo_filter: dict,
) -> list[dict]:
    dedup_group: dict[str, Any] = {
        "_id": {"grp": f"${group_field}", "dt": f"${date_field}"},
    }
    for _op, field in metric_field_ops:
        dedup_group[f"dv_{field}"] = {"$avg": f"${field}"}

    final_group: dict[str, Any] = {
        "_id": "$_id.grp",
        "count": {"$sum": 1},
    }
    for op, field in metric_field_ops:
        final_group[f"{op}_{field}"] = {f"${op}": f"$dv_{field}"}

    pipeline: list[dict] = [
        {"$match": mongo_filter or {}},
        {"$group": dedup_group},
        {"$group": final_group},
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
                    row[key] = (round(float(raw), 2) if isinstance(raw, float) else raw) if raw is not None else None
                else:
                    row[key] = None
            rows.append(row)
        logger.info(
            "[ANALYTICS] _group_by_metric_date_deduped: collection=%s group=%s ops=%s rows=%d",
            collection, group_field,
            [f"{op}_{f}" for op, f in metric_field_ops],
            len(rows),
        )
        return rows
    except Exception as exc:
        logger.debug("[ANALYTICS] _group_by_metric_date_deduped failed: %s", exc)
        return []

async def _avg_docs_per_date(
    repo: GenericRepository,
    collection: str,
    date_field: str,
) -> float:
    try:
        pipeline = [
            {"$limit": 2000},
            {"$group": {"_id": f"${date_field}", "n": {"$sum": 1}}},
            {"$group": {"_id": None, "avg": {"$avg": "$n"}}},
        ]
        result = await repo.aggregate(collection, pipeline)
        if result and result[0].get("avg") is not None:
            return float(result[0]["avg"])
    except Exception as exc:
        logger.debug("[DATE_DEDUP] sampling failed for '%s': %s", collection, exc)
    return 1.0

async def _is_multi_record_per_date(
    repo: GenericRepository,
    collection: str,
    all_fields: list[str],
) -> bool:
    if collection in _DATE_DEDUP_CACHE:
        return _DATE_DEDUP_CACHE[collection]
    date_field = find_date_field(all_fields)
    if not date_field:
        _DATE_DEDUP_CACHE[collection] = False
        return False
    avg = await _avg_docs_per_date(repo, collection, date_field)
    is_multi = avg > 1.2
    _DATE_DEDUP_CACHE[collection] = is_multi
    logger.info(
        "[DATE_DEDUP] collection=%s date_field=%s avg_per_date=%.2f multi_record=%s",
        collection, date_field, avg, is_multi,
    )
    return is_multi

async def _numeric_agg_date_deduped(
    repo: GenericRepository,
    collection: str,
    date_field: str,
    metric_field: str,
    op: str,
    mongo_filter: dict,
) -> Optional[float]:
    try:
        pipeline: list[dict] = [
            {"$match": mongo_filter or {}},
            {"$group": {"_id": f"${date_field}", "day_val": {"$avg": f"${metric_field}"}}},
            {"$group": {"_id": None, "result": {f"${op}": "$day_val"}}},
        ]
        docs = await repo.aggregate(collection, pipeline)
        if docs and "result" in docs[0] and docs[0]["result"] is not None:
            r = docs[0]["result"]
            return round(float(r), 2) if isinstance(r, float) else r
    except Exception as exc:
        logger.debug("[DATE_DEDUP] %s(%s) failed: %s", op, metric_field, exc)
    return None

async def _is_date_level_metric(
    repo: GenericRepository,
    collection: str,
    date_field: str,
    metric_field: str,
) -> bool:
    cache_key = (collection, metric_field)
    if cache_key in _DATE_LEVEL_FIELD_CACHE:
        return _DATE_LEVEL_FIELD_CACHE[cache_key]

    try:
        pipeline: list[dict] = [
            {"$limit": 2000},
            {
                "$group": {
                    "_id": f"${date_field}",
                    "doc_count": {"$sum": 1},
                    "values": {"$addToSet": f"${metric_field}"},
                }
            },
            {"$match": {"doc_count": {"$gt": 1}}},
            {"$project": {"distinct_count": {"$size": "$values"}}},
            {
                "$group": {
                    "_id": None,
                    "sampled_dates": {"$sum": 1},
                    "max_distinct": {"$max": "$distinct_count"},
                }
            },
        ]
        result = await repo.aggregate(collection, pipeline)
        is_date_level = bool(
            result
            and result[0].get("sampled_dates", 0) > 0
            and result[0].get("max_distinct", 0) <= 1
        )
        _DATE_LEVEL_FIELD_CACHE[cache_key] = is_date_level
        logger.info(
            "[DATE_DEDUP] collection=%s field=%s date_level=%s",
            collection, metric_field, is_date_level,
        )
        return is_date_level
    except Exception as exc:
        logger.debug(
            "[DATE_DEDUP] date-level detection failed for %s.%s: %s",
            collection, metric_field, exc,
        )
        _DATE_LEVEL_FIELD_CACHE[cache_key] = False
        return False

async def _resolve_latest_date_filter(
    repo: GenericRepository,
    collection: str,
    date_field: str,
    base_filter: dict,
) -> dict:
    try:
        pipeline = [
            {"$match": base_filter or {}},
            {"$group": {"_id": None, "max_date": {"$max": f"${date_field}"}}},
        ]
        result = await repo.aggregate(collection, pipeline)
        if result and result[0].get("max_date"):
            latest = result[0]["max_date"]
            logger.info("[DATE_DEDUP] 'latest' resolved to %s for '%s'", latest, collection)
            return {date_field: {"$gte": latest, "$lte": latest}}
    except Exception as exc:
        logger.debug("[DATE_DEDUP] latest date lookup failed for '%s': %s", collection, exc)
    return {}

def _query_requests_rate(query: str) -> Optional[str]:
    q = (query or "").lower()
    if any(term in q for term in ("pass rate", "passing rate", "pass percentage", "compliance rate")):
        return "pass"
    if any(term in q for term in ("fail rate", "failure rate", "fail percentage")):
        return "fail"
    return None

def _query_requests_historical_scope(query: str) -> bool:
    q = (query or "").lower()
    return any(term in q for term in ("overall", "all time", "all-time", "historical", "entire dataset", "across all"))

def _find_result_field(fields: list[str]) -> Optional[str]:
    preferred = ("inspection_result", "result", "outcome", "status")
    fields_lower = {f.lower(): f for f in fields}
    for name in preferred:
        if name in fields_lower:
            return fields_lower[name]
    for f in fields:
        fl = f.lower()
        if any(token in fl for token in ("result", "outcome", "status")):
            return f
    return None

async def _categorical_rate(
    repo: GenericRepository,
    collection: str,
    field: str,
    positive_value: str,
    mongo_filter: dict,
) -> Optional[dict[str, Any]]:
    try:
        value_re = f"^{_re.escape(positive_value)}$"
        numerator_filter = {
            **(mongo_filter or {}),
            field: {"$regex": value_re, "$options": "i"},
        }
        numerator = await repo.count(collection, numerator_filter)
        denominator = await repo.count(collection, mongo_filter or None)
        if denominator <= 0:
            return None
        return {
            "label": f"{positive_value.title()} Rate",
            "field": field,
            "match_value": positive_value.title(),
            "matched_count": numerator,
            "total_count": denominator,
            "percentage": round((numerator / denominator) * 100, 2),
        }
    except Exception as exc:
        logger.debug("[ANALYTICS] categorical rate failed: %s", exc)
        return None

async def run_analytics(
    query_meta: QueryMeta,
    collection_names: list[str],
    metadata: dict,
    repo: GenericRepository,
    top_n: int = 5,
) -> dict[str, Any]:
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
        date_field = find_date_field(all_fields)

        mongo_filter = _build_mongo_filter(query_meta.filters, all_fields)

        time_filter: dict = {}
        if getattr(query_meta, "time_range", None):
            if date_field:
                time_filter = resolve_time_range_to_filter(query_meta.time_range, date_field)
                if time_filter:
                    logger.info(
                        "[ANALYTICS] time_range=%r → %s", query_meta.time_range, time_filter
                    )

        combined_filter = {**mongo_filter, **time_filter}
        coll_results: dict[str, Any] = {"filter": combined_filter}
        multi_record_per_date = (
            await _is_multi_record_per_date(repo, collection, all_fields)
            if date_field else False
        )

        if not ops or "count" in ops:
            count = await repo.count(collection, combined_filter or None)
            coll_results["count"] = count
            logger.info("[ANALYTICS] %s count=%d filter=%s", collection, count, combined_filter)
            if combined_filter:
                total_count = await repo.count(collection, None)
                coll_results["total_count"] = total_count
                logger.info("[ANALYTICS] %s total_count=%d", collection, total_count)

        if "group_by" in ops and query_meta.grouping:
            resolved_gb = _resolve_field(query_meta.grouping, all_fields)
            if resolved_gb:
                numeric_ops_present = [o for o in ["avg", "sum", "max", "min"] if o in ops]
                metric_field_ops: list[tuple[str, str]] = []
                date_level_metric_ops: list[tuple[str, str]] = []
                seen: set[tuple[str, str]] = set()
                for op in numeric_ops_present:
                    for metric in (query_meta.metrics or []):
                        rf = _resolve_field(metric, all_fields)
                        if rf and _is_numeric_field(rf) and (op, rf) not in seen:
                            is_date_level = (
                                multi_record_per_date
                                and date_field
                                and await _is_date_level_metric(repo, collection, date_field, rf)
                            )
                            if is_date_level:
                                date_level_metric_ops.append((op, rf))
                            else:
                                metric_field_ops.append((op, rf))
                            seen.add((op, rf))

                regular_rows: list[dict] | None = None
                if metric_field_ops:
                    regular_rows = await _group_by_metric(
                        repo, collection, resolved_gb, metric_field_ops, combined_filter
                    )

                dedup_rows: list[dict] | None = None
                if date_level_metric_ops and date_field:
                    dedup_rows = await _group_by_metric_date_deduped(
                        repo, collection, resolved_gb, date_field,
                        date_level_metric_ops, combined_filter
                    )

                all_ops = (
                    [f"{op}_{rf}" for op, rf in metric_field_ops]
                    + [f"{op}_{rf}" for op, rf in date_level_metric_ops]
                )
                if regular_rows and dedup_rows:
                    dedup_by_value = {r["value"]: r for r in dedup_rows}
                    for row in regular_rows:
                        dr = dedup_by_value.get(row["value"], {})
                        for op, rf in date_level_metric_ops:
                            row[f"{op}_{rf}"] = dr.get(f"{op}_{rf}")
                    coll_results["group_by_metrics"] = {
                        "field": resolved_gb, "ops": all_ops, "rows": regular_rows,
                    }
                elif regular_rows:
                    coll_results["group_by_metrics"] = {
                        "field": resolved_gb,
                        "ops": [f"{op}_{rf}" for op, rf in metric_field_ops],
                        "rows": regular_rows,
                    }
                elif dedup_rows:
                    coll_results["group_by_metrics"] = {
                        "field": resolved_gb,
                        "ops": [f"{op}_{rf}" for op, rf in date_level_metric_ops],
                        "rows": dedup_rows,
                    }

                if "group_by_metrics" in coll_results:
                    logger.info(
                        "[ANALYTICS] %s group_by_metrics field=%s rows=%d (regular=%d, date_level=%d)",
                        collection, resolved_gb,
                        len(coll_results["group_by_metrics"]["rows"]),
                        len(metric_field_ops), len(date_level_metric_ops),
                    )
                elif not metric_field_ops and not date_level_metric_ops:
                    counts = await _group_by_count(repo, collection, resolved_gb, combined_filter)
                    coll_results["group_by"] = {"field": resolved_gb, "counts": counts}
                    logger.info(
                        "[ANALYTICS] %s group_by=%s values=%d", collection, resolved_gb, len(counts)
                    )
                else:
                    counts = await _group_by_count(repo, collection, resolved_gb, combined_filter)
                    coll_results["group_by"] = {"field": resolved_gb, "counts": counts}

        for op in ["avg", "sum"]:
            if op in ops:
                for metric in (query_meta.metrics or []):
                    resolved_field = _resolve_field(metric, all_fields)
                    if resolved_field and _is_numeric_field(resolved_field):
                        metric_filter = combined_filter
                        use_date_dedup = (
                            multi_record_per_date
                            and date_field
                            and await _is_date_level_metric(repo, collection, date_field, resolved_field)
                        )
                        if use_date_dedup and not time_filter and op == "sum":
                            latest_filter = await _resolve_latest_date_filter(
                                repo, collection, date_field, mongo_filter
                            )
                            if latest_filter:
                                metric_filter = {**mongo_filter, **latest_filter}
                                coll_results["filter"] = metric_filter
                        val = (
                            await _numeric_agg_date_deduped(
                                repo, collection, date_field, resolved_field, op, metric_filter
                            )
                            if use_date_dedup
                            else await _numeric_agg(
                                repo, collection, resolved_field, op, metric_filter
                            )
                        )
                        if val is not None:
                            coll_results[f"{op}_{resolved_field}"] = val
                            logger.info(
                                "[ANALYTICS] %s %s(%s)=%s date_dedup=%s",
                                collection, op, resolved_field, val, use_date_dedup,
                            )

        has_group_by = bool("group_by" in ops and query_meta.grouping)
        for op in ["max", "min"]:
            if op in ops:
                for metric in (query_meta.metrics or []):
                    resolved_field = _resolve_field(metric, all_fields)
                    if resolved_field and _is_numeric_field(resolved_field):
                        use_date_dedup = (
                            multi_record_per_date
                            and date_field
                            and await _is_date_level_metric(repo, collection, date_field, resolved_field)
                        )
                        scoped_val = (
                            await _numeric_agg_date_deduped(
                                repo, collection, date_field, resolved_field, op, combined_filter
                            )
                            if use_date_dedup
                            else await _numeric_agg(
                                repo, collection, resolved_field, op, combined_filter
                            )
                        )
                        if scoped_val is not None:
                            coll_results[f"{op}_{resolved_field}"] = scoped_val
                            logger.info(
                                "[ANALYTICS] %s %s(%s)=%s filter=%s date_dedup=%s",
                                collection, op, resolved_field, scoped_val, combined_filter, use_date_dedup,
                            )
                        if not has_group_by:
                            top_docs = await _top_n_by_field(
                                repo, collection, resolved_field, op, combined_filter, n=top_n
                            )
                            if top_docs:
                                key = "top_records" if op == "max" else "bottom_records"
                                coll_results[key] = top_docs

        requested_rate = _query_requests_rate(getattr(query_meta, "raw_query", ""))
        if requested_rate:
            result_field = _find_result_field(all_fields)
            if result_field:
                rate_filter = combined_filter
                if (
                    multi_record_per_date
                    and date_field
                    and not time_filter
                    and not _query_requests_historical_scope(getattr(query_meta, "raw_query", ""))
                ):
                    latest_filter = await _resolve_latest_date_filter(
                        repo, collection, date_field, mongo_filter
                    )
                    if latest_filter:
                        rate_filter = {**mongo_filter, **latest_filter}
                rate = await _categorical_rate(
                    repo, collection, result_field, requested_rate, rate_filter
                )
                if rate:
                    if rate_filter != combined_filter:
                        rate["filter"] = rate_filter
                    coll_results.setdefault("derived_metrics", []).append(rate)
                    logger.info(
                        "[ANALYTICS] %s %s via %s = %.2f%% (%d/%d)",
                        collection,
                        rate["label"],
                        result_field,
                        rate["percentage"],
                        rate["matched_count"],
                        rate["total_count"],
                    )

        results[collection] = coll_results

    return results
