"""
Intent classifier — routes every query into one of nine paths.

Paths
-----
conversational      greeting / small talk / acknowledgement — skip DB, skip LLM context
domain_knowledge    how / why / explain questions about concepts — LLM-only, no DB
analytics           aggregations, counts, KPIs, metrics, distributions, rankings
comparison          query explicitly comparing two time periods, entities, or datasets
summary             broad overview, dashboard, multi-metric executive summary
forecasting         predictions, projections, future trends, estimates
data_query          specific data retrieval — the safe default for everything else
equipment_listing   general inventory question: what equipment or documents exist in the system
workflow_automation write-action requests the read-only system cannot fulfill

One small LLM call; no DB round-trip.
"""

from __future__ import annotations

import logging
import re

from llm.client import LLMClient

logger = logging.getLogger("voxa.orchestrator.intent")

INTENT_LABELS = frozenset({
    "conversational",
    "domain_knowledge",
    "workflow_automation",
    "analytics",
    "comparison",
    "summary",
    "forecasting",
    "data_query",
    "equipment_listing",
})

_SYSTEM = """\
Classify the user's query into EXACTLY ONE of these nine intents.
Reply with ONLY the intent label — nothing else.

conversational      : greeting, small talk, thanks, acknowledgement, "how are you", "ok", "bye"
domain_knowledge    : conceptual or educational questions answered from general knowledge — NOT from records.
                      The key signal: the answer does NOT require looking up a specific record or number.
                      Examples: "what is X", "explain X", "how does X work", "what does X mean",
                      "what does X stand for", definitions, medical concepts, manufacturing principles,
                      regulatory terms, acronym expansions, scientific explanations.
                      CRITICAL — NOT domain_knowledge:
                      • "What [things] do we have/use/operate/manufacture/offer/manage?" → data_query
                        (these ask about OUR specific records, not general knowledge)
                      • "Show me details about [specific named entity]" → data_query
                      • "What medicines/drugs/machinery/suppliers/hospitals do we have?" → data_query
equipment_listing   : general inventory question about what equipment or documents exist in the
                      system, with no specific topic or question being asked.
                      Examples: "what equipment is available", "show me all docs", "what's indexed here",
                      "what documents do we have in the system", "list all equipment",
                      "what can I ask about", "what files are uploaded", "show available equipment".
                      CRITICAL — only use this when the user wants a general inventory list, NOT when
                      they are asking a specific question about a piece of equipment or document.
workflow_automation : requests to perform a WRITE action — book, create, schedule, add, update,
                      modify, edit, delete, remove, cancel, assign, register, enroll, submit,
                      export, download, generate a report/alert/file, send, or set up a reminder.
                      The system is read-only and will reject these, but they must be classified
                      correctly so the rejection message is appropriate.
analytics           : aggregations, counts, KPIs, averages, distributions, rankings, metrics analysis
                      (look for "how many", "total", "average", "top N", "rate", "percentage", "breakdown")
comparison          : explicitly comparing two time periods, plants, models, products, or entities
                      (look for "vs", "versus", "compare", "difference between", "last week vs this week")
summary             : broad overview, dashboard, executive brief, or multi-metric summary
forecasting         : predictions, projections, future trends, estimates, "will", "expect", "forecast"
                      (look for "predict", "forecast", "next month", "trend", "will there be", "expected")
data_query          : retrieve specific records, lists, patient details, documents, inventory items,
                      AND "what do we have/use/operate/offer/make" + "show details about [specific entity]"

If unsure → data_query
"""

# ── Fast-path regexes ──────────────────────────────────────────────────────────

_CONVERSATIONAL_RE = re.compile(
    r"^\s*(hello|hi+|hey|howdy|good\s+(morning|afternoon|evening|night)|"
    r"how\s+are\s+you|thanks?|thank\s+you|ok(ay)?|alright|bye|goodbye|"
    r"see\s+you|take\s+care|great|cool|nice|got\s+it|understood|sure|yep|yup)\s*[!.,]?\s*$",
    re.I,
)

_ANALYTICS_RE = re.compile(
    r"\b(how\s+many|total\s+number|count\s+of|average|avg|mean|median|"
    r"top\s+\d+|bottom\s+\d+|highest|lowest|maximum|minimum|max|min|"
    r"distribution|breakdown|percentage|percent|rate|ratio|proportion|"
    r"ranking|ranked|most\s+\w+|least\s+\w+|sum\s+of|aggregat|"
    r"utilization|utilisation|pass\s+rate|fail\s+rate|throughput|"
    r"by\s+shift|by\s+status|by\s+area|by\s+stage|by\s+severity|by\s+product|"
    r"alert\s+count|batch\s+count|inspection\s+count|deviation\s+count|"
    r"most\s+common|most\s+frequent|"
    r"how\s+many\s+\w+\s+(are|have|is|were)|"
    r"total\s+(units|batches|alerts|inspections|deviations|ncrs|capas|count|number))\b",
    re.I,
)

_COMPARISON_RE = re.compile(
    r"\b(vs\.?|versus|compare|comparison|difference\s+between|"
    r"(last|this|previous)\s+\w+\s+(vs|versus|compared\s+to|against))\b",
    re.I,
)

_SUMMARY_RE = re.compile(
    r"\b(dashboard|overview|summary|brief|executive\s+(summary|brief)|"
    r"overall\s+(performance|status|view)|give\s+me\s+a\s+(report|rundown|snapshot))\b",
    re.I,
)

_FORECASTING_RE = re.compile(
    r"\b(forecast|predict|projection|expected|next\s+(month|quarter|year|week)|"
    r"will\s+there\s+be|future\s+trend|estimated|anticipate|upcoming)\b",
    re.I,
)

# Matches general inventory questions: "what equipment/documents are available/indexed/here"
# with no specific topic — pure listing intent.
# Must run BEFORE data_query so it doesn't silently become a record retrieval.
_EQUIPMENT_LISTING_RE = re.compile(
    r"("
    r"what\s+(equipment|documents?|docs?|files?)\s+(are\s+)?(available|indexed|here|in\s+(the\s+)?system)"
    r"|show\s+(me\s+)?(all\s+)?(equipment|documents?|docs?|files?)"
    r"|list\s+(all\s+)?(equipment|documents?|docs?|files?|available)"
    r"|what\s+(is|'?s)\s+(available|indexed)\s+(here|in\s+(the\s+)?system)?"
    r"|what\s+can\s+i\s+(ask|query)\s+(about|here)?"
    r"|what\s+(documents?|docs?|files?|equipment)\s+do\s+we\s+have\s+(in\s+(the\s+)?system)?"
    r"|what\s+'?s\s+(indexed|uploaded|in\s+(the\s+)?system)"
    r")",
    re.I,
)

# Matches write-action requests that the read-only system cannot fulfill.
# Must run before domain_knowledge / data_query so "book appointment" doesn't
# silently become a data retrieval query.
_WORKFLOW_RE = re.compile(
    r"\b("
    r"book|schedule\s+(an?\s+)?(appointment|meeting|session)|"
    r"(create|add|insert|register|enroll)\s+(an?\s+)?(patient|appointment|record|user|account|entry)|"
    r"(update|modify|edit|change)\s+.*(record|appointment|patient|details|status)|"
    r"(delete|remove|cancel|deactivate)\s+(an?\s+)?(patient|appointment|record|account)|"
    r"(export|download|extract)\s+(all\s+)?\w+\s*(records?|data|as\s+(csv|excel|pdf|json))|"
    r"(generate|create|build|run)\s+(an?\s+)?(report|alert|scheduled|automation)|"
    r"(send|email|notify|alert)\s+(an?\s+)?(report|notification|reminder)|"
    r"set\s+up\s+(an?\s+)?(alert|reminder|automation|schedule)|"
    r"make\s+(an?\s+)?(appointment|booking|reservation)"
    r")\b",
    re.I,
)

# Matches conceptual / educational questions that need no DB lookup.
# Pure linguistic patterns — no domain-specific terms hardcoded.
# Runs AFTER all other fast-paths so analytics/comparison/summary take priority.
# NOTE: "What X do we have/use/operate/offer/manage?" is excluded — those are data_query.
_DOMAIN_KNOWLEDGE_RE = re.compile(
    r"(what\s+does\s+.+\s+mean"                   # "what does X mean"
    r"|what\s+is\s+(a|an)\s+\w"                   # "what is a/an X"
    r"|\b(explain|define|describe)\s+\w"           # "explain/define/describe X"
    r"|how\s+(does|do|is|are)\s+(?!.*\bwe\b).+"   # "how does X work" — but NOT "how do we X"
    r"\s+(work|function|calculat|measur|defin|determin|operat)"
    r"|what\s+does\s+.+\s+stand\s+for"            # "what does X stand for"
    r"|\bwhat\s+is\s+meant\s+by\b)",              # "what is meant by X"
    re.I,
)


async def classify_intent(query: str, llm: LLMClient) -> str:
    """
    Return one of INTENT_LABELS for *query*.
    Fast-path regex handles unambiguous cases; LLM handles the rest.
    """
    q = query.strip()

    # Fast-path: obvious conversational
    if _CONVERSATIONAL_RE.match(q):
        logger.debug("Intent fast-path: conversational | query=%r", q[:60])
        return "conversational"

    # Fast-path: write-action / workflow — must run before data_query catch-all
    if _WORKFLOW_RE.search(q):
        logger.debug("Intent fast-path: workflow_automation | query=%r", q[:60])
        return "workflow_automation"

    # Fast-path: clear comparison signal
    if _COMPARISON_RE.search(q):
        logger.debug("Intent fast-path: comparison | query=%r", q[:60])
        return "comparison"

    # Fast-path: clear summary signal
    if _SUMMARY_RE.search(q):
        logger.debug("Intent fast-path: summary | query=%r", q[:60])
        return "summary"

    # Fast-path: analytics / aggregation
    if _ANALYTICS_RE.search(q):
        logger.debug("Intent fast-path: analytics | query=%r", q[:60])
        return "analytics"

    # Fast-path: forecasting
    if _FORECASTING_RE.search(q):
        logger.debug("Intent fast-path: forecasting | query=%r", q[:60])
        return "forecasting"

    # Fast-path: domain knowledge — conceptual / educational questions
    # Runs last among fast-paths so analytics/comparison/summary take priority
    if _DOMAIN_KNOWLEDGE_RE.search(q):
        logger.debug("Intent fast-path: domain_knowledge | query=%r", q[:60])
        return "domain_knowledge"

    # Fast-path: equipment / document listing
    if _EQUIPMENT_LISTING_RE.search(q):
        logger.debug("Intent fast-path: equipment_listing | query=%r", q[:60])
        return "equipment_listing"

    # LLM classification for ambiguous cases
    try:
        raw = llm.complete(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": q},
            ]
        ).strip().lower()

        for label in INTENT_LABELS:
            if label in raw:
                logger.info("Intent (LLM): %s | query=%r", label, q[:60])
                return label
    except Exception as exc:
        logger.warning("Intent classification LLM call failed: %s", exc)

    return "data_query"
