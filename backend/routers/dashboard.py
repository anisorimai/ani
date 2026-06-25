"""
Dashboard summary endpoints — production and quality.

GET /api/production-dashboard/summary
  Returns aggregated production metrics (today, yesterday, last 9 days,
  shift data, param ranges) from the `production_dashboard` MongoDB collection.

GET /api/quality-dashboard/summary
  Returns aggregated quality metrics (today, yesterday, last 9 days)
  from the `quality_dashboard` MongoDB collection.
"""

from datetime import date as _date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from database.mongodb import get_db

router = APIRouter()

# ── Production dashboard ───────────────────────────────────────────────────────

_PROD_COLLECTION = "production_dashboard"

_AREA_COLS     = ["area_granulation_units", "area_compression_units",
                  "area_coating_units",     "area_packaging_units",
                  "area_others_units"]
_BATCH_COLS    = ["batches_completed", "batches_in_progress",
                  "batches_pending",   "batches_on_hold"]
_ALERT_COLS    = ["alert_high_count", "alert_medium_count", "alert_low_count"]
_ACTIVITY_COLS = ["activity_equipment_calibration_due",
                  "activity_preventive_maintenance_due",
                  "activity_changeover_scheduled",
                  "activity_qc_review_time"]
_PARAM_COLS    = ["granulator_speed_rpm", "coater_inlet_temp_celsius",
                  "compression_force_kn",  "humidity_pct_rh",
                  "differential_pressure_pa", "water_system_toc_ppb"]


def _avg(values: list) -> float:
    nums = [v for v in values if isinstance(v, (int, float))]
    return sum(nums) / len(nums) if nums else 0.0


def _sum(values: list) -> float:
    return sum(v for v in values if isinstance(v, (int, float)))


def _prod_aggregate_day(docs: list[dict]) -> dict | None:
    if not docs:
        return None

    total_batches = _sum([d.get("total_batches", 0) for d in docs])
    completed     = _sum([d.get("batches_completed", 0) for d in docs])
    in_progress   = _sum([d.get("batches_in_progress", 0) for d in docs])

    batches = {"total": int(total_batches)}
    for col in _BATCH_COLS:
        key = col.replace("batches_", "")
        batches[key] = int(_sum([d.get(col, 0) for d in docs]))

    areas = {}
    for col in _AREA_COLS:
        key = col.replace("area_", "").replace("_units", "")
        areas[key] = int(_sum([d.get(col, 0) for d in docs]))

    params = {col: round(_avg([d.get(col) for d in docs]), 2) for col in _PARAM_COLS}

    alerts = {}
    for col in _ALERT_COLS:
        key = col.replace("alert_", "").replace("_count", "")
        alerts[key] = int(_sum([d.get(col, 0) for d in docs]))

    activities = {}
    for col in _ACTIVITY_COLS:
        key = col.replace("activity_", "")
        vals = [d.get(col) for d in docs if d.get(col) is not None]
        if vals:
            activities[key] = vals[-1] if isinstance(vals[0], str) else int(_sum(vals))

    total_produced = _sum([d.get("total_units_produced", 0) for d in docs])
    total_target   = _sum([d.get("units_target", 0) for d in docs])

    return {
        "totalProduced":    int(total_produced),
        "totalTarget":      int(total_target),
        "capacityPct":      round(_avg([d.get("capacity_utilization_pct") for d in docs]), 1),
        "onTimePct":        round(_avg([d.get("on_time_delivery_pct") for d in docs]), 1),
        "openIssues":       int(_sum([d.get("open_issues_count", 0) for d in docs])),
        "batchSuccessRate": round((completed / total_batches * 100) if total_batches else 0, 1),
        "qualityPassRate":  round(((completed + in_progress) / total_batches * 100) if total_batches else 0, 1),
        "batches":    batches,
        "areas":      areas,
        "params":     params,
        "alerts":     alerts,
        "activities": activities,
    }


@router.get("/production-dashboard/summary")
async def production_dashboard_summary(
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD; defaults to today or latest available"),
):
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    coll = db[_PROD_COLLECTION]

    # All distinct sorted dates
    pipeline = [{"$group": {"_id": "$record_date"}}, {"$sort": {"_id": 1}}]
    dates: list[str] = [doc["_id"] async for doc in coll.aggregate(pipeline)]

    if not dates:
        raise HTTPException(status_code=404, detail=f"No documents found in '{_PROD_COLLECTION}'")

    today_str = _date.today().isoformat()
    if target_date:
        if target_date not in dates:
            raise HTTPException(status_code=404, detail=f"Date {target_date} not found")
        today_key = target_date
    elif today_str in dates:
        today_key = today_str
    else:
        today_key = dates[-1]

    today_idx     = dates.index(today_key)
    yesterday_key = dates[today_idx - 1] if today_idx > 0 else None
    last9_keys    = dates[max(0, today_idx - 8): today_idx + 1]

    async def fetch_day(date_key: str) -> list[dict]:
        return [doc async for doc in coll.find({"record_date": date_key}, {"_id": 0})]

    today_docs     = await fetch_day(today_key)
    yesterday_docs = await fetch_day(yesterday_key) if yesterday_key else []

    last9 = []
    for dk in last9_keys:
        docs = await fetch_day(dk)
        agg  = _prod_aggregate_day(docs)
        if agg:
            last9.append({**agg, "date": dk})

    # Shift-level breakdown for the current day (chronological order)
    _SHIFT_ORDER = {"Morning": 0, "Afternoon": 1, "Night": 2}
    shift_data = [
        {
            "shift":    doc.get("shift"),
            "produced": round(doc.get("total_units_produced", 0) / 1000),
            "target":   round(doc.get("units_target", 0) / 1000),
        }
        for doc in sorted(today_docs, key=lambda d: _SHIFT_ORDER.get(d.get("shift", ""), 99))
    ]

    # Param ranges across the entire collection (for gauge min/max)
    param_ranges: dict = {}
    for col in _PARAM_COLS:
        agg_pipe = [
            {"$group": {"_id": None, "min": {"$min": f"${col}"}, "max": {"$max": f"${col}"}}},
        ]
        result = [doc async for doc in coll.aggregate(agg_pipe)]
        if result:
            param_ranges[col] = {"min": result[0]["min"], "max": result[0]["max"]}

    return {
        "today":       _prod_aggregate_day(today_docs),
        "yesterday":   _prod_aggregate_day(yesterday_docs) if yesterday_docs else None,
        "last9":       last9,
        "latestDate":  today_key,
        "shiftData":   shift_data,
        "paramRanges": param_ranges,
    }


# ── Quality dashboard ──────────────────────────────────────────────────────────

_COLLECTION = "quality_dashboard"


# ── aggregation helper (mirrors useQualityData.js aggregateQualityDay) ─────────

def _aggregate_day(docs: list[dict]) -> dict | None:
    if not docs:
        return None

    first = docs[0]
    total  = len(docs)
    passes = sum(1 for d in docs if d.get("inspection_result") == "Pass")

    audits = []
    for n in (1, 2, 3):
        name = first.get(f"audit{n}_name", "")
        if name and name not in ("", "undefined", None):
            audits.append({
                "name":     name,
                "dept":     first.get(f"audit{n}_department", ""),
                "date":     first.get(f"audit{n}_date", ""),
                "priority": first.get(f"audit{n}_priority", ""),
            })

    return {
        "qualityPassRate":    passes / total * 100 if total else 0,
        "avgInspectionScore": sum(d.get("inspection_score", 0) for d in docs) / total,
        "totalInspected":     total,
        "passCount":          passes,
        "failCount":          total - passes,
        "openNcrs":           first.get("open_ncrs_count", 0),
        "capaPending":        first.get("capa_pending_count", 0),
        "capaCritical":       first.get("capa_critical_count", 0),
        "capaMajor":          first.get("capa_major_count", 0),
        "auditScore":         first.get("audit_score_pct", 0),
        "prevAuditScore":     first.get("previous_audit_score_pct", 0),
        "deviationCritical":  first.get("deviation_critical_count", 0),
        "deviationMajor":     first.get("deviation_major_count", 0),
        "deviationMinor":     first.get("deviation_minor_count", 0),
        "upcomingAudits":     audits,
    }


async def _fetch_day(coll, date_key: str) -> list[dict]:
    docs = []
    async for doc in coll.find({"record_date": date_key}, {"_id": 0}):
        docs.append(doc)
    return docs


# ── endpoint ────────────────────────────────────────────────────────────────────

@router.get("/quality-dashboard/summary")
async def quality_dashboard_summary(
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD; defaults to today or latest available"),
):
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    coll = db[_COLLECTION]

    # Get all distinct sorted dates present in the collection
    pipeline = [{"$group": {"_id": "$record_date"}}, {"$sort": {"_id": 1}}]
    dates: list[str] = [doc["_id"] async for doc in coll.aggregate(pipeline)]

    if not dates:
        raise HTTPException(status_code=404, detail=f"No documents found in '{_COLLECTION}'")

    today_str = _date.today().isoformat()

    if target_date:
        if target_date not in dates:
            raise HTTPException(status_code=404, detail=f"Date {target_date} not found in dataset")
        today_key = target_date
    elif today_str in dates:
        today_key = today_str
    else:
        today_key = dates[-1]

    today_idx     = dates.index(today_key)
    yesterday_key = dates[today_idx - 1] if today_idx > 0 else None
    last9_keys    = dates[max(0, today_idx - 8): today_idx + 1]

    # Fetch and aggregate
    today_docs     = await _fetch_day(coll, today_key)
    yesterday_docs = await _fetch_day(coll, yesterday_key) if yesterday_key else []

    last9 = []
    for dk in last9_keys:
        docs = await _fetch_day(coll, dk)
        agg  = _aggregate_day(docs)
        if agg:
            last9.append({**agg, "date": dk})

    return {
        "today":      _aggregate_day(today_docs),
        "yesterday":  _aggregate_day(yesterday_docs) if yesterday_docs else None,
        "last9":      last9,
        "latestDate": today_key,
    }


@router.get("/quality-dashboard/recent-inspections")
async def quality_recent_inspections(
    limit: int = Query(5, ge=1, le=50),
    reference_date: Optional[str] = Query(None, description="Return records on or before this date (YYYY-MM-DD). Defaults to today or latest available."),
):
    db = get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    coll = db[_COLLECTION]

    if not reference_date:
        today_str = _date.today().isoformat()
        # Use the latest date that is <= today, matching the summary endpoint behaviour
        pipeline = [{"$group": {"_id": "$record_date"}}, {"$sort": {"_id": 1}}]
        dates: list[str] = [doc["_id"] async for doc in coll.aggregate(pipeline)]
        if dates:
            reference_date = today_str if today_str in dates else dates[-1]

    query = {"record_date": {"$lte": reference_date}} if reference_date else {}
    fields = {"_id": 0, "batch_id": 1, "product_name": 1, "inspection_stage": 1,
              "inspection_score": 1, "inspection_result": 1, "record_date": 1}
    docs = []
    async for doc in coll.find(query, fields).sort(
        [("record_date", -1), ("batch_id", 1)]
    ).limit(limit):
        docs.append(doc)
    return docs
