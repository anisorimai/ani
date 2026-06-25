"""
Query Normalizer — converts natural language into structured query metadata.

Extracts:
  - metrics     : measurable NUMERIC values requested (e.g. "total_amount", "score")
  - entities    : named things the query is about (people, places, products)
  - filters     : key→value conditions to apply (e.g. {"status": "active"})
  - aggregations: operations like count, sum, avg, max, min, group_by
  - time_range  : temporal scope as a string (e.g. "this month", "2024")
  - grouping    : field to group results by (e.g. "region", "gender", "status")

The extracted metadata is used downstream to:
  1. Build better MongoDB search queries
  2. Guide collection selection
  3. Inject structured context into the LLM system prompt
  4. Populate the standardised API response metadata
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional
import re
from llm.client import LLMClient

logger = logging.getLogger("voxa.orchestrator.normalizer")

_SYSTEM = """\
You are a query metadata extractor for ANI Pharmaceuticals — a pharmaceutical manufacturing plant.
Given a user query, extract structured information and return ONLY valid JSON.

The plant tracks two datasets:
  production_dashboard — shift-level production records (Morning/Afternoon/Night) with:
    units produced, capacity utilization, on-time delivery, open issues, batch counts and statuses,
    production area outputs (granulation/compression/coating/packaging), equipment parameters
    (granulator speed RPM, coater inlet temperature, compression force, humidity, differential
    pressure, water system TOC), alert counts (high/medium/low), and scheduled activities
    (calibration due, preventive maintenance due, changeover scheduled, QC review time).
  quality_dashboard — batch-level quality inspection records with:
    product name, inspection stage (Incoming/In-Process/Stability), inspection score and result
    (Pass/Fail), deviation severity (None/Minor/Major/Critical), NCR count, CAPA counts (pending/
    critical/major), audit score, previous audit score, deviation counts by severity, and upcoming
    audit schedules (name, department, date, priority).

Return a JSON object with these exact fields:
  "metrics"      : list of measurable NUMERIC field names (snake_case strings)
  "entities"     : list of named entities mentioned (batches, shifts, inspections, etc.)
  "filters"      : dict of field→value constraints
  "aggregations" : list of operations: "count", "sum", "avg", "max", "min", "group_by"
  "time_range"   : time period as a string, or null
  "grouping"     : field name to group/distribute results by, or null

═══ CRITICAL RULES ═══

RULE 1 — GROUP_BY vs FILTER (most important):
  • When the query uses "vs", "versus", "compared to", or lists MULTIPLE VALUES of the
    same field to count/compare (e.g. "completed vs in-progress", "pass vs fail",
    "by shift", "by status", "breakdown", "distribution"):
      → set grouping = that field name
      → include "count" AND "group_by" in aggregations
      → do NOT put those values in filters
      CRITICAL: "completed vs on hold", "pass vs fail" etc. must ALL use grouping, never filters.

  • When the query asks about ONE specific value only (e.g. "how many completed batches",
    "how many failed inspections"):
      → set filters = {"batch_status": "Completed"}, aggregations = ["count"]
      → grouping = null

RULE 2 — METRICS must be NUMERIC fields only.
  NEVER put ID fields ("batch_id", "record_id") in metrics — they are strings.
  Good metrics: "total_units_produced", "capacity_utilization_pct", "on_time_delivery_pct",
                "inspection_score", "audit_score_pct", "open_ncrs_count", "capa_pending_count",
                "alert_high_count", "granulator_speed_rpm", "humidity_pct_rh"
  Bad metrics:  "batch_id", "product_name", "shift" (these are strings or identifiers)

RULE 3 — COMPOUND QUERIES: capture ALL requested metrics and aggregations.

RULE 4 — MAX/MIN: only add filters when the user explicitly restricts the scope.

RULE 5 — AVG always pairs with a numeric metric field name.

═══ PHARMA FIELD REFERENCE ═══

production_dashboard fields:
  record_date, shift, total_units_produced, units_target, capacity_utilization_pct,
  on_time_delivery_pct, open_issues_count,
  area_granulation_units, area_compression_units, area_coating_units,
  area_packaging_units, area_others_units,
  batch_id, batch_status, total_batches, batches_completed, batches_in_progress,
  batches_pending, batches_on_hold,
  granulator_speed_rpm, coater_inlet_temp_celsius, compression_force_kn,
  humidity_pct_rh, differential_pressure_pa, water_system_toc_ppb,
  alert_high_count, alert_medium_count, alert_low_count,
  activity_equipment_calibration_due, activity_preventive_maintenance_due,
  activity_changeover_scheduled, activity_qc_review_time

quality_dashboard fields:
  record_date, batch_id, product_name, inspection_stage, inspection_score,
  inspection_result, deviation_severity, open_ncrs_count, capa_pending_count,
  capa_critical_count, capa_major_count, audit_score_pct, previous_audit_score_pct,
  deviation_critical_count, deviation_major_count, deviation_minor_count,
  audit1_name, audit1_department, audit1_date, audit1_priority,
  audit2_name, audit2_department, audit2_date, audit2_priority,
  audit3_name, audit3_department, audit3_date, audit3_priority

═══ EXAMPLES ═══

"How many units were produced today?"
→ {"metrics":["total_units_produced"],"entities":["production"],"filters":{},"aggregations":["sum"],"time_range":"today","grouping":null}

"What is the average capacity utilization this week?"
→ {"metrics":["capacity_utilization_pct"],"entities":["production"],"filters":{},"aggregations":["avg"],"time_range":"this week","grouping":null}

"Show batch status breakdown"
→ {"metrics":[],"entities":["batches"],"filters":{},"aggregations":["count","group_by"],"time_range":null,"grouping":"batch_status"}

"Compare completed vs in-progress vs pending batches"
→ {"metrics":[],"entities":["batches"],"filters":{},"aggregations":["count","group_by"],"time_range":null,"grouping":"batch_status"}

"How many batches are on hold?"
→ {"metrics":[],"entities":["batches"],"filters":{"batch_status":"On Hold"},"aggregations":["count"],"time_range":null,"grouping":null}

"Show production output by shift"
→ {"metrics":["total_units_produced"],"entities":["production","shifts"],"filters":{},"aggregations":["sum","group_by"],"time_range":null,"grouping":"shift"}

"What is the morning shift capacity utilization?"
→ {"metrics":["capacity_utilization_pct"],"entities":["production"],"filters":{"shift":"Morning"},"aggregations":["avg"],"time_range":null,"grouping":null}

"How many high-priority alerts are there?"
→ {"metrics":["alert_high_count"],"entities":["alerts"],"filters":{},"aggregations":["sum"],"time_range":null,"grouping":null}

"Show alert counts by severity"
→ {"metrics":["alert_high_count","alert_medium_count","alert_low_count"],"entities":["alerts"],"filters":{},"aggregations":["sum"],"time_range":null,"grouping":null}

"What is the production breakdown by area?"
→ {"metrics":["area_granulation_units","area_compression_units","area_coating_units","area_packaging_units"],"entities":["production_areas"],"filters":{},"aggregations":["sum"],"time_range":null,"grouping":null}

"What is the on-time delivery rate?"
→ {"metrics":["on_time_delivery_pct"],"entities":["production"],"filters":{},"aggregations":["avg"],"time_range":null,"grouping":null}

"Show equipment parameters for today"
→ {"metrics":["granulator_speed_rpm","coater_inlet_temp_celsius","compression_force_kn","humidity_pct_rh","differential_pressure_pa","water_system_toc_ppb"],"entities":["equipment_parameters"],"filters":{},"aggregations":["avg"],"time_range":"today","grouping":null}

"How many activities are due for calibration?"
→ {"metrics":["activity_equipment_calibration_due"],"entities":["activities"],"filters":{},"aggregations":["sum"],"time_range":null,"grouping":null}

"What is the inspection pass rate?"
→ {"metrics":["inspection_score"],"entities":["quality_inspections"],"filters":{},"aggregations":["count","group_by","avg"],"time_range":null,"grouping":"inspection_result"}

"How many inspections passed vs failed?"
→ {"metrics":[],"entities":["inspections"],"filters":{},"aggregations":["count","group_by"],"time_range":null,"grouping":"inspection_result"}

"How many failed inspections are there?"
→ {"metrics":[],"entities":["inspections"],"filters":{"inspection_result":"Fail"},"aggregations":["count"],"time_range":null,"grouping":null}

"Show inspection results by stage"
→ {"metrics":["inspection_score"],"entities":["inspections"],"filters":{},"aggregations":["count","group_by","avg"],"time_range":null,"grouping":"inspection_stage"}

"What is the deviation breakdown by severity?"
→ {"metrics":[],"entities":["deviations"],"filters":{},"aggregations":["count","group_by"],"time_range":null,"grouping":"deviation_severity"}

"How many critical deviations are there?"
→ {"metrics":["deviation_critical_count"],"entities":["deviations"],"filters":{"deviation_severity":"Critical"},"aggregations":["sum"],"time_range":null,"grouping":null}

"How many NCRs are open?"
→ {"metrics":["open_ncrs_count"],"entities":["ncrs"],"filters":{},"aggregations":["sum"],"time_range":null,"grouping":null}

"What is the CAPA status?"
→ {"metrics":["capa_pending_count","capa_critical_count","capa_major_count"],"entities":["capa"],"filters":{},"aggregations":["sum"],"time_range":null,"grouping":null}

"Show pending CAPAs"
→ {"metrics":["capa_pending_count"],"entities":["capa"],"filters":{},"aggregations":["sum"],"time_range":null,"grouping":null}

"What is the current audit score?"
→ {"metrics":["audit_score_pct"],"entities":["audits"],"filters":{},"aggregations":["avg"],"time_range":null,"grouping":null}

"Compare current audit score vs previous"
→ {"metrics":["audit_score_pct","previous_audit_score_pct"],"entities":["audits"],"filters":{},"aggregations":["avg"],"time_range":null,"grouping":null}

"Show upcoming audits"
→ {"metrics":[],"entities":["audits"],"filters":{},"aggregations":[],"time_range":"upcoming","grouping":null}

"Which products have the most deviations?"
→ {"metrics":["deviation_critical_count","deviation_major_count","deviation_minor_count"],"entities":["products","deviations"],"filters":{},"aggregations":["count","group_by"],"time_range":null,"grouping":"product_name"}

"Give me an overview of production performance"
→ {"metrics":["total_units_produced","capacity_utilization_pct","on_time_delivery_pct"],"entities":["production"],"filters":{},"aggregations":["sum","avg"],"time_range":null,"grouping":null}

"Give me a quality overview"
→ {"metrics":["inspection_score","audit_score_pct","open_ncrs_count","capa_pending_count"],"entities":["quality"],"filters":{},"aggregations":["avg","sum"],"time_range":null,"grouping":null}

"Which shift produces the most units?"
→ {"metrics":["total_units_produced"],"entities":["production","shifts"],"filters":{},"aggregations":["sum","group_by","max"],"time_range":null,"grouping":"shift"}

"What are the total batches completed this month?"
→ {"metrics":["batches_completed"],"entities":["batches"],"filters":{},"aggregations":["sum"],"time_range":"this month","grouping":null}
"""


_TOP_N_RE = re.compile(
    r'\b(?:top|first|leading)\s+(\d+)\b|\bbottom\s+(\d+)\b|\blast\s+(\d+)\b',
    re.IGNORECASE,
)


def _extract_top_n(query: str) -> int:
    """Return the N in 'top N' / 'bottom N' queries, capped at 100. Defaults to 5."""
    m = _TOP_N_RE.search(query)
    if m:
        n_str = next(g for g in m.groups() if g is not None)
        return min(int(n_str), 100)
    return 5


@dataclass
class QueryMeta:
    """Structured metadata extracted from a natural language query."""
    metrics: list[str] = field(default_factory=list)
    entities: list[str] = field(default_factory=list)
    filters: dict[str, Any] = field(default_factory=dict)
    aggregations: list[str] = field(default_factory=list)
    time_range: Optional[str] = None
    grouping: Optional[str] = None
    top_n: int = 5
    raw_query: str = ""

    def to_dict(self) -> dict:
        return {
            "metrics": self.metrics,
            "entities": self.entities,
            "filters": self.filters,
            "aggregations": self.aggregations,
            "time_range": self.time_range,
            "grouping": self.grouping,
            "top_n": self.top_n,
        }

    def is_empty(self) -> bool:
        return not (self.metrics or self.entities or self.filters)

    def search_hints(self) -> list[str]:
        """Return flat list of terms useful for keyword search augmentation."""
        hints: list[str] = []
        hints.extend(self.metrics)
        hints.extend(self.entities)
        hints.extend(str(v) for v in self.filters.values() if isinstance(v, str))
        if self.grouping:
            hints.append(self.grouping)
        return [h.lower() for h in hints if h and isinstance(h, str)]


async def normalize_query(query: str, llm: LLMClient) -> QueryMeta:
    """
    Extract structured metadata from *query*.

    Returns an empty QueryMeta on any failure — the pipeline continues
    without structured metadata rather than failing entirely.
    """
    try:
        raw = llm.complete(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": query},
            ],
            json_mode=True,
        )
        # complete() may return str or dict depending on json_mode support
        if isinstance(raw, str):
            import json as _json
            try:
                data = _json.loads(raw)
            except Exception:
                # Try extracting JSON from text
                import re
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                data = _json.loads(m.group(0)) if m else {}
        else:
            data = raw or {}

        # Sanitize metrics: strip out obvious ID/string fields
        _ID_SUFFIXES = ("_id", "_number", "_code", "_key", "id")
        raw_metrics = data.get("metrics") or []
        clean_metrics = [
            m for m in raw_metrics
            if isinstance(m, str)
            and not any(m.lower().endswith(s) for s in _ID_SUFFIXES)
            and m.lower() not in ("id", "key", "code")
        ]

        raw_entities = data.get("entities") or []
        clean_entities = [e for e in raw_entities if isinstance(e, str)]

        meta = QueryMeta(
            metrics=clean_metrics,
            entities=clean_entities,
            filters=data.get("filters") or {},
            aggregations=data.get("aggregations") or [],
            time_range=data.get("time_range") or None,
            grouping=data.get("grouping") or None,
            top_n=_extract_top_n(query),
            raw_query=query,
        )
        logger.info(
            "[NORMALIZER] metrics=%s entities=%s filters=%s aggs=%s time=%s group=%s top_n=%d",
            meta.metrics,
            meta.entities,
            meta.filters,
            meta.aggregations,
            meta.time_range,
            meta.grouping,
            meta.top_n,
        )
        return meta
    except Exception as exc:
        logger.warning("[NORMALIZER] failed (%s) — using empty meta", exc)
        return QueryMeta(raw_query=query, top_n=_extract_top_n(query))
