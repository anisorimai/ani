"""
Shared date-field detection and time-range resolution utilities.

Used by both query_orchestrator (fetch paths) and analytics_executor
so that date filters are applied consistently wherever data is retrieved.
"""
from __future__ import annotations

import logging
import re as _re
from typing import Optional

logger = logging.getLogger("voxa.orchestrator.date_utils")


def find_date_field(fields: list) -> Optional[str]:
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


def resolve_time_range_to_filter(time_range: str, date_field: str) -> dict:
    """
    Convert a natural-language time_range string into a MongoDB date range filter.
    Uses datetime.today() as the live reference — no hardcoded dates.
    Supports: next/last N days/weeks/months/years, this/last week/month/year,
              today, yesterday, Q1-Q4 YYYY, month-name YYYY, plain year, specific dates.
    """
    import calendar as _cal
    from datetime import date, timedelta

    today = date.today()
    tr = time_range.lower().strip(" ?.,;")

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
    
    # Month DD, YYYY (e.g. "march 15, 2026")
    m = _re.match(r"(" + "|".join(_MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$", tr)
    if m:
        month_num = _MONTHS[m.group(1)]
        day = int(m.group(2))
        year = int(m.group(3))
        try:
            from datetime import date as _date
            d = _date(year, month_num, day)
            return {date_field: {"$gte": str(d), "$lte": str(d)}}
        except ValueError:
            pass

    m = _re.match(r"(" + "|".join(_MONTHS) + r")(?:\s+(\d{4}))?$", tr)
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

    # Specific date: YYYY-MM-DD
    m = _re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", tr)
    if m:
        try:
            from datetime import date as _date
            d = _date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return {date_field: {"$gte": str(d), "$lte": str(d)}}
        except ValueError:
            pass

    # Specific date: DD/MM/YYYY or MM/DD/YYYY (a > 12 forces day-first)
    m = _re.match(r"(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?", tr)
    if m:
        try:
            a, b = int(m.group(1)), int(m.group(2))
            year = int(m.group(3)) if m.group(3) else today.year
            if year < 100:
                year += 2000
            from datetime import date as _date
            d = _date(year, b, a) if a > 12 else _date(year, a, b)
            return {date_field: {"$gte": str(d), "$lte": str(d)}}
        except ValueError:
            pass

    logger.debug("[TIME_FILTER] unrecognised time_range %r — no date filter applied", time_range)
    return {}
