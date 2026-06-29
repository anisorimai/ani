"""
Response composer — wraps raw LLM output into a StructuredResponse
and builds the system prompt used by the LLM.

Standardised response format
-----------------------------
{
  "success"         : bool,
  "source"          : str,        # "mongodb_keyword" | "mongodb_vector" | "llm" | "none"
  "intent"          : str,        # detected intent label
  "data"            : list[dict], # raw records (empty list when not applicable)
  "insights"        : list[str],  # 2-3 key observations (empty list when not applicable)
  "response"        : str,        # LLM-generated narrative
  "collections_used": list[str],
  "confidence"      : float,
  "latency_ms"      : int,
  "followups"       : list[str],
  "metadata"        : dict
}
"""

import time
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class StructuredResponse:
    """Standardised response object returned by the orchestrator to all callers."""
    success: bool = True
    response: str = ""
    source: str = "llm"                     # data origin
    intent: str = "data_query"              # classified intent
    data: list[dict] = field(default_factory=list)      # raw records for the frontend
    insights: list[str] = field(default_factory=list)   # extracted key observations
    collections_used: list[str] = field(default_factory=list)
    confidence: float = 1.0
    latency_ms: int = 0
    followups: list[str] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)  # source filenames cited by LLM
    metadata: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        from rag.retriever import query_understanding_var
        try:
            val = query_understanding_var.get()
            if val and "query_understanding" not in self.metadata:
                # Merge into a copy to avoid modifying a default dict or shared state
                self.metadata = dict(self.metadata)
                self.metadata["query_understanding"] = val
        except Exception:
            pass

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "source": self.source,
            "intent": self.intent,
            "data": self.data,
            "insights": self.insights,
            "response": self.response,
            "collections_used": self.collections_used,
            "confidence": round(self.confidence, 3),
            "latency_ms": self.latency_ms,
            "followups": self.followups,
            "citations": self.citations,
            "metadata": self.metadata,
        }


def build_system_prompt(
    data_context: str,
    intent: str = "data_query",
    low_confidence: bool = False,
) -> str:
    """Backward-compatible wrapper — delegates to prompts.builder."""
    from prompts.builder import PromptContext, build_system_prompt as _build
    return _build(PromptContext(
        intent=intent,
        data_context=data_context,
        low_confidence=low_confidence,
    ))


def _extract_insights(response_text: str, max_insights: int = 3) -> list[str]:
    """
    Heuristically pull bullet-point or numbered-list lines from the LLM response
    as the 'insights' field.  Returns empty list when the response has no list items.
    """
    import re
    pattern = re.compile(r"^\s*[-•*]|\s*\d+\.\s", re.M)
    insights: list[str] = []
    for line in response_text.splitlines():
        if pattern.match(line):
            clean = re.sub(r"^\s*[-•*\d.]+\s*", "", line).strip()
            if clean and len(clean) > 10:
                insights.append(clean)
            if len(insights) >= max_insights:
                break
    return insights


def compose(
    llm_response: str,
    collections_used: list[str],
    latency_ms: int,
    confidence: float = 1.0,
    source: str = "mongodb_keyword",
    intent: str = "data_query",
    data: Optional[list[dict]] = None,
    followups: Optional[list[str]] = None,
    citations: Optional[list[dict]] = None,
    metadata: Optional[dict] = None,
    success: bool = True,
) -> StructuredResponse:
    """Build a StructuredResponse from an LLM narration result."""
    text = llm_response.strip()
    return StructuredResponse(
        success=success,
        response=text,
        source=source,
        intent=intent,
        data=data or [],
        insights=_extract_insights(text),
        collections_used=collections_used,
        confidence=confidence,
        latency_ms=latency_ms,
        followups=followups or [],
        citations=citations or [],
        metadata=metadata or {},
    )
