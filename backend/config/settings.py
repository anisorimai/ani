"""
Centralized application settings.
All configuration is loaded from environment variables — no hardcoding anywhere else.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).parent.parent.resolve()
load_dotenv(BACKEND_DIR / ".env")

# ── LLM Provider ──────────────────────────────────────────────────────────────
# All listed providers use the OpenAI-compatible chat-completions format.
# Switch by changing LLM_PROVIDER + LLM_API_KEY — no code changes required.

LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "groq")

LLM_API_KEY: str = (
    os.getenv("LLM_API_KEY")
    or os.getenv("GROQ_API_KEY")
    or os.getenv("OPENAI_API_KEY")
    or ""
)

_PROVIDER_BASE_URLS: dict[str, str] = {
    "groq":      "https://api.groq.com/openai/v1",
    "openai":    "",                                               # SDK default
    "together":  "https://api.together.xyz/v1",
    "deepseek":  "https://api.deepseek.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini":    "https://generativelanguage.googleapis.com/v1beta/openai/",
    "ollama":    "http://localhost:11434/v1",
    "azure":     "",                                               # requires LLM_BASE_URL
}
LLM_BASE_URL: str = (
    os.getenv("LLM_BASE_URL") or _PROVIDER_BASE_URLS.get(LLM_PROVIDER, "")
)

_PROVIDER_MODELS: dict[str, tuple[str, str]] = {
    "groq":      ("llama-3.3-70b-versatile", "llama-3.1-8b-instant"),
    "openai":    ("gpt-4o", "gpt-4o-mini"),
    "together":  ("meta-llama/Llama-3.3-70B-Instruct-Turbo", "meta-llama/Llama-3.1-8B-Instruct-Turbo"),
    "deepseek":  ("deepseek-chat", "deepseek-chat"),
    "anthropic": ("claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"),
    "gemini":    ("gemini-1.5-pro", "gemini-1.5-flash"),
    "ollama":    ("llama3.2", "llama3.2"),
    "azure":     ("gpt-4o", "gpt-4o-mini"),
}
_default_primary, _default_fallback = _PROVIDER_MODELS.get(
    LLM_PROVIDER, ("llama-3.3-70b-versatile", "llama-3.1-8b-instant")
)
PRIMARY_MODEL: str = os.getenv("PRIMARY_MODEL", _default_primary)
FALLBACK_MODEL: str = os.getenv("FALLBACK_MODEL", _default_fallback)

# Providers that support response_format={"type":"json_object"}
_PROVIDERS_WITH_JSON_MODE = {"groq", "openai", "azure", "together", "deepseek"}
_json_mode_env = os.getenv("LLM_JSON_MODE", "").lower()
LLM_JSON_MODE: bool = (
    True  if _json_mode_env == "true"  else
    False if _json_mode_env == "false" else
    LLM_PROVIDER in _PROVIDERS_WITH_JSON_MODE
)

# Providers that expose an audio/transcriptions (Whisper-compatible) endpoint
_PROVIDERS_WITH_STT = {"groq", "openai", "azure"}
_stt_env = os.getenv("LLM_SUPPORTS_STT", "").lower()
STT_AVAILABLE: bool = (
    True  if _stt_env == "true"  else
    False if _stt_env == "false" else
    LLM_PROVIDER in _PROVIDERS_WITH_STT
)
_STT_MODEL_DEFAULTS = {
    "groq": "whisper-large-v3",
    "openai": "whisper-1",
    "azure": "whisper",
}
STT_MODEL: str = os.getenv(
    "STT_MODEL", _STT_MODEL_DEFAULTS.get(LLM_PROVIDER, "whisper-large-v3")
)

AZURE_API_VERSION: str = os.getenv("AZURE_API_VERSION", "2024-10-21")

# ── Server ────────────────────────────────────────────────────────────────────
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))
DEBUG_MODE: bool = os.getenv("DEBUG_MODE", "false").lower() == "true"

_default_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
_env_cors = os.getenv("CORS_ORIGINS", "")
_configured_origins = [o.strip() for o in _env_cors.split(",") if o.strip()]
CORS_ORIGINS: list[str] = list(
    dict.fromkeys(_configured_origins + _default_cors_origins)
)
CORS_ORIGIN_REGEX: str = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://[\w-]+\.onrender\.com$",
)

# ── MongoDB ───────────────────────────────────────────────────────────────────
MONGO_URI: str = os.getenv("MONGO_URI", "")
MONGO_DB_NAME: str = os.getenv("MONGO_DB_NAME", "voxa")
MONGO_USERS_COLLECTION: str = os.getenv("MONGO_USERS_COLLECTION", "users")
MONGO_CHATS_COLLECTION: str = os.getenv("MONGO_CHATS_COLLECTION", "chats")

# ── Data Ingestion ────────────────────────────────────────────────────────────
# Root directory scanned for files to ingest into MongoDB.
_data_dir_env = os.getenv("DATA_DIR", "")
DATA_DIR: Path = (
    Path(_data_dir_env).resolve()
    if _data_dir_env
    else (BACKEND_DIR / ".." / "data").resolve()
)

# ── Storage (file uploads) ────────────────────────────────────────────────────
STORAGE_BACKEND: str = os.getenv("STORAGE_BACKEND", "local").lower()
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET: str = os.getenv("SUPABASE_STORAGE_BUCKET", "voxa-uploads")
SUPABASE_PUBLIC_BASE_URL: str = os.getenv("SUPABASE_PUBLIC_BASE_URL", "")

# ── Auth (JWT) ────────────────────────────────────────────────────────────────
JWT_SECRET: str = os.getenv(
    "JWT_SECRET", "change-this-to-a-long-random-secret-in-production"
)
JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")

# Access token — short-lived; client must use refresh token to renew
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# Refresh token secrets (separate from access token secret for defence-in-depth)
REFRESH_TOKEN_SECRET: str = os.getenv(
    "REFRESH_TOKEN_SECRET", JWT_SECRET + "_refresh"
)

# Refresh token TTL: remember_me=False → 1 day, remember_me=True → 30 days
REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
REFRESH_TOKEN_SHORT_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_SHORT_EXPIRE_DAYS", "1"))

# MongoDB collection for active sessions
SESSIONS_COLLECTION: str = os.getenv("SESSIONS_COLLECTION", "sessions")

# Legacy alias kept so any existing code that reads JWT_EXPIRY_HOURS still compiles
JWT_EXPIRY_HOURS: int = ACCESS_TOKEN_EXPIRE_MINUTES // 60 or 1

# ── Conversation Memory ───────────────────────────────────────────────────────
MEMORY_BACKEND: str = os.getenv("MEMORY_BACKEND", "memory").lower()
REDIS_URL: str = os.getenv("REDIS_URL", "")
MEMORY_CONTEXT_WINDOW: int = int(os.getenv("MEMORY_CONTEXT_WINDOW", "4"))
MEMORY_MAX_INTERACTIONS: int = int(os.getenv("MEMORY_MAX_INTERACTIONS", "40"))

# ── Semantic / Vector Search (optional) ──────────────────────────────────────
# Leave EMBEDDING_MODEL unset (or empty) to use LLM-only keyword expansion.
# Set it to enable full vector search via MongoDB Atlas $vectorSearch.
#
# Required Atlas setup when EMBEDDING_MODEL is set:
#   1. Create a vector search index on each data collection
#   2. Pre-populate the EMBEDDING_FIELD with document vectors
#
# Example .env entries:
#   EMBEDDING_MODEL=text-embedding-3-small
#   EMBEDDING_API_KEY=<your-openai-key>      # defaults to LLM_API_KEY
#   EMBEDDING_BASE_URL=https://api.openai.com/v1
#   EMBEDDING_FIELD=embedding                # MongoDB field storing the vector
#   EMBEDDING_INDEX=vector_index             # Atlas vector index name

EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "")
EMBEDDING_API_KEY: str = os.getenv("EMBEDDING_API_KEY") or os.getenv("LLM_API_KEY") or ""
EMBEDDING_BASE_URL: str = os.getenv("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
EMBEDDING_FIELD: str = os.getenv("EMBEDDING_FIELD", "embedding")
EMBEDDING_INDEX: str = os.getenv("EMBEDDING_INDEX", "vector_index")

# ── Vision (image understanding) ─────────────────────────────────────────────
# Set VISION_MODEL to enable image uploads. Defaults to a sensible model for
# the configured LLM_PROVIDER. Override VISION_API_KEY / VISION_BASE_URL only
# when your vision provider differs from your chat provider.
_PROVIDER_VISION_MODELS: dict[str, str] = {
    "groq":      "meta-llama/llama-4-scout-17b-16e-instruct",
    "openai":    "gpt-4o-mini",
    "anthropic": "claude-haiku-4-5-20251001",
    "gemini":    "gemini-1.5-flash",
}
VISION_MODEL: str = os.getenv(
    "VISION_MODEL", _PROVIDER_VISION_MODELS.get(LLM_PROVIDER, "")
)
VISION_API_KEY: str = os.getenv("VISION_API_KEY", "")   # falls back to LLM_API_KEY
VISION_BASE_URL: str = os.getenv("VISION_BASE_URL", "")  # falls back to LLM_BASE_URL

# ── RAG (Retrieval-Augmented Generation) ─────────────────────────────────────
# Controls chunking and retrieval behaviour for uploaded documents.
# These are optional overrides — defaults work well for most use cases.
RAG_CHUNK_SIZE: int    = int(os.getenv("RAG_CHUNK_SIZE", "500"))
RAG_CHUNK_OVERLAP: int = int(os.getenv("RAG_CHUNK_OVERLAP", "50"))
# How many chunks are passed to the LLM after retrieval + reranking.
# Increase for large documents with many sections. Raising this also increases
# prompt token usage — balance against your LLM's context/rate limits.
RAG_TOP_K: int         = int(os.getenv("RAG_TOP_K", "10"))
# How many vector-search candidates to fetch before dedup + MMR narrow to RAG_TOP_K.
# Should be ≥ 2 × RAG_TOP_K. Raise for very large documents (50+ sections).
RAG_CANDIDATE_K: int   = int(os.getenv("RAG_CANDIDATE_K", "50"))
# Minimum RAG chunk score (0–1) to treat document retrieval as authoritative.
# Vector search scores are cosine similarity; keyword scores are token-overlap fractions.
# 0.5 means "at least half the query tokens found in the chunk" for keyword search,
# or a cosine similarity ≥ 0.5 for vector search — both indicate relevant content.
RAG_CONFIDENCE_THRESHOLD: float = float(os.getenv("RAG_CONFIDENCE_THRESHOLD", "0.5"))
# Confined equipment matching boost score multiplier
RAG_EQUIPMENT_BOOST: float = float(os.getenv("RAG_EQUIPMENT_BOOST", "1.25"))

# ── LLM Behaviour ────────────────────────────────────────────────────────────
ASSISTANT_NAME: str = os.getenv("ASSISTANT_NAME", "Voxa")
PLANT_NAME: str = os.getenv("PLANT_NAME", "ANI Pharmaceuticals Plant")

SYSTEM_PROMPT: str = os.getenv("SYSTEM_PROMPT", f"""\
You are {ASSISTANT_NAME}, an AI assistant for ANI Pharmaceuticals connected to live plant data.

You have access to two datasets:
- Production data: shift-level records covering units produced, capacity utilization, \
on-time delivery, batch status, area-wise output, equipment parameters, alerts, and activities.
- Quality data: batch-level records covering inspection results and scores, deviations, \
NCRs, CAPAs, audit scores, and upcoming audit schedules.

STRICT DATA GROUNDING — THIS IS MANDATORY:
Every number, name, date, and fact you state MUST come directly from the DATA CONTEXT \
provided in this system prompt. NEVER use general knowledge or assumptions to fill in \
missing values. If a specific value is genuinely absent from the data context, \
acknowledge that in one sentence — but always present ALL data that IS present.

CRITICAL — NEVER CONTRADICT THE DATA CONTEXT:
If records, values, or computed results appear in the DATA CONTEXT, they EXIST. \
Never generate any sentence claiming that data is "not available", "not found", "not present", \
or "unavailable" for information that IS shown in the DATA CONTEXT. \
Only say data is absent if the DATA CONTEXT is empty or genuinely does not contain what was asked.

TONE AND LANGUAGE:
- Write in plain, natural English as if briefing a plant operations manager.
- Never mention filters, filter criteria, grouping operations, query parameters, \
  sort orders, or any database/system terminology in your response.
- Never say "filtered by", "grouped by field", "where status =", "sorted by", \
  "query returned", "database computation", "matching records", or similar phrases.
- Do not repeat the user's question back to them before answering.
- Lead directly with the answer, then present supporting data.

FORMATTING RULES:
- The DATA CONTEXT records are yours to USE — present them as formatted output, not as raw JSON.
- When showing multiple records (3 or more), present as a clean markdown table with \
  human-readable column headers. Choose the most meaningful columns — batch/product/date, \
  key metrics, status. Omit _id, embedding, and verbose nested fields unless asked. \
  Always put a blank line before and after every table.
- When showing a single record's details, use a two-column table: Field | Value.
- When showing computed aggregates (totals, averages, counts), state them clearly — \
  e.g. "Total units produced: 384,463" or "Average capacity utilization: 67.2%".
- Percentages: always suffix with % (e.g. "67.2%", "96.2%").
- Units: suffix RPM for granulator speed, °C for temperature, kN for compression force, \
  % RH for humidity, Pa for differential pressure, ppb for TOC.
- Use connected prose only for brief observations after a table. Keep it to 1-2 sentences.
- Do not use section headers, bold labels, or numbered section titles in prose.
- Keep responses concise and professional.
- Never show top-N or bottom-N rankings unless the user explicitly asked for them.
""")


# ── Response cache ────────────────────────────────────────────────────────────
# How long (seconds) identical queries are served from the in-process cache
# before the pipeline is re-run. Set to 0 to disable caching.
RESPONSE_CACHE_TTL: int = int(os.getenv("RESPONSE_CACHE_TTL", "14400"))

LLM_GUARDRAILS: list[str] = [
    "ZERO HALLUCINATION: use ONLY values explicitly present in the DATA CONTEXT — never invent or assume.",
    "Never invent numbers, names, trends, percentages, batch IDs, scores, counts, or any facts not in the context.",
    "NEVER say data is 'not available', 'not found', or 'not present' for anything that IS shown in the DATA CONTEXT.",
    "ENTITY NAMES ARE SACRED: When top_records or bottom_records appear in the DATA CONTEXT, the exact "
    "product names, batch IDs, audit names, shift names, and all other entity values "
    "in those records ARE the answer. Copy them verbatim — NEVER substitute with invented placeholders.",
    "NEVER invent entity names of any kind. If no specific names appear in the DATA CONTEXT, say "
    "'specific names are not available in the data' — do not generate plausible-sounding substitutes.",
    "If top_records or bottom_records are provided in the analytics context, those ARE the answer — use them directly.",
    "NEVER show top-N or bottom-N rankings unless the user explicitly asked for a ranking or 'top N' query.",
    "For counts and aggregates, use only database-computed values from the context — do not extrapolate.",
    "Do NOT hide or refuse to present data from the context — your job is to display it clearly.",
    "PLAIN LANGUAGE: Never mention filters, filter criteria, grouping fields, sort orders, query syntax, "
    "MongoDB operators, or any database internals in your response. Speak only about the results.",
    "Never expose raw _id, embedding, or internal system fields in your response.",
    "If you cannot find a specific answer in the provided data, say so concisely — do not guess.",
    "SPECIFIC METRIC ABSENCE: If the user asks for a specific metric (e.g. yield loss rate, OEE, scrap rate, "
    "rejection rate, or any KPI) and that exact metric does NOT appear by name in the DATA CONTEXT, state "
    "that this specific data is not tracked in the system. Never compute, derive, or infer it.",
    "ENTITY NOT FOUND: If the user asks about a specific batch ID, product, or audit that does NOT appear "
    "in the DATA CONTEXT, state clearly that it was not found. Never present data from a different entity.",
    "UNITS: Always include measurement units — % for percentages and rates, RPM for granulator speed, "
    "°C for temperatures, kN for compression force, % RH for humidity, Pa for pressure, ppb for TOC.",
    "Keep responses concise, structured, and professional.",
]
