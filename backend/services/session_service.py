"""
Session service — persists refresh tokens in MongoDB.
Falls back to an in-memory store when MongoDB is not connected (dev mode).

Each document represents one active "remember this device" session.
A TTL index on expires_at makes MongoDB auto-delete expired sessions.

Rotating refresh tokens:
  Every call to /auth/refresh revokes the old token_id and issues a new one,
  limiting the blast radius if a refresh token is ever stolen.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from config.settings import (
    SESSIONS_COLLECTION,
    REFRESH_TOKEN_EXPIRE_DAYS,
    REFRESH_TOKEN_SHORT_EXPIRE_DAYS,
)
from database.mongodb import get_db, is_connected

logger = logging.getLogger("voxa.session")

_indexes_created = False

# ── In-memory fallback store (used when MongoDB is not connected) ──────────
_memory_sessions: dict[str, dict] = {}


def _get_store():
    """Return the MongoDB collection if connected, else None for in-memory."""
    if is_connected():
        db = get_db()
        if db is not None:
            return ("mongo", db[SESSIONS_COLLECTION])
    return ("memory", None)


async def _ensure_indexes() -> None:
    """Create indexes once per process lifetime."""
    global _indexes_created
    if _indexes_created:
        return
    store_type, col = _get_store()
    if store_type == "mongo":
        await col.create_index("token_id", unique=True)
        # TTL index — MongoDB deletes expired docs automatically
        await col.create_index("expires_at", expireAfterSeconds=0)
        await col.create_index("user_id")
        _indexes_created = True
        logger.info("Session indexes ensured")


async def create_session(
    user_id: str,
    user_email: str,
    remember_me: bool = False,
) -> tuple[str, datetime]:
    """
    Persist a new session.  Returns (token_id, expires_at).

    token_id is embedded in the refresh JWT and looked up on every /refresh call.
    expires_at drives both the JWT exp claim and the MongoDB TTL index.
    """
    token_id = uuid.uuid4().hex
    expire_days = REFRESH_TOKEN_EXPIRE_DAYS if remember_me else REFRESH_TOKEN_SHORT_EXPIRE_DAYS
    expires_at = datetime.now(timezone.utc) + timedelta(days=expire_days)

    store_type, col = _get_store()

    if store_type == "mongo":
        await _ensure_indexes()
        await col.insert_one({
            "token_id":     token_id,
            "user_id":      user_id,
            "user_email":   user_email,
            "remember_me":  remember_me,
            "expires_at":   expires_at,
            "created_at":   datetime.now(timezone.utc),
            "last_used_at": datetime.now(timezone.utc),
            "revoked":      False,
        })
    else:
        # In-memory fallback
        _memory_sessions[token_id] = {
            "token_id":     token_id,
            "user_id":      user_id,
            "user_email":   user_email,
            "remember_me":  remember_me,
            "expires_at":   expires_at,
            "created_at":   datetime.now(timezone.utc),
            "last_used_at": datetime.now(timezone.utc),
            "revoked":      False,
        }

    logger.debug("Session created: remember_me=%s expires=%s", remember_me, expires_at.date())
    return token_id, expires_at


async def get_valid_session(token_id: str) -> Optional[dict]:
    """
    Return the session document if it is active (not revoked, not expired).
    Touches last_used_at on success.
    Returns None if the session is invalid.
    """
    now = datetime.now(timezone.utc)
    store_type, col = _get_store()

    if store_type == "mongo":
        session = await col.find_one({
            "token_id": token_id,
            "revoked":  False,
            "expires_at": {"$gt": now},
        })
        if session:
            await col.update_one(
                {"token_id": token_id},
                {"$set": {"last_used_at": now}},
            )
        return session
    else:
        # In-memory fallback
        session = _memory_sessions.get(token_id)
        if session and not session["revoked"] and session["expires_at"] > now:
            session["last_used_at"] = now
            return session
        return None


async def revoke_session(token_id: str) -> None:
    """Revoke a single session (single-device logout)."""
    store_type, col = _get_store()

    if store_type == "mongo":
        await col.update_one(
            {"token_id": token_id},
            {"$set": {"revoked": True}},
        )
    else:
        if token_id in _memory_sessions:
            _memory_sessions[token_id]["revoked"] = True

    logger.debug("Session revoked")


async def revoke_all_user_sessions(user_id: str) -> None:
    """Revoke every session for a user (logout everywhere)."""
    store_type, col = _get_store()

    if store_type == "mongo":
        result = await col.update_many(
            {"user_id": user_id, "revoked": False},
            {"$set": {"revoked": True}},
        )
        logger.info("Revoked sessions: count=%s", result.modified_count)
    else:
        count = 0
        for sess in _memory_sessions.values():
            if sess["user_id"] == user_id and not sess["revoked"]:
                sess["revoked"] = True
                count += 1
        logger.info("Revoked sessions: count=%s", count)