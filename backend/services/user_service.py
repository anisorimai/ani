"""
User service — CRUD operations against the 'users' MongoDB collection.
Falls back to an in-memory store when MongoDB is not connected (dev mode).

Passwords are hashed with bcrypt before storage.
Plain-text password comparison is done via verify_password().
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from config.settings import MONGO_USERS_COLLECTION
from database.mongodb import get_db, is_connected
from auth.password_utils import hash_password, verify_password

logger = logging.getLogger("voxa.user_service")

# ── In-memory fallback store (used when MongoDB is not connected) ──────────
_memory_users: dict[str, dict[str, Any]] = {}
_memory_lock = False


def _get_store():
    """Return the MongoDB collection if connected, else None for in-memory."""
    if is_connected():
        db = get_db()
        if db is not None:
            return ("mongo", db[MONGO_USERS_COLLECTION])
    return ("memory", None)


def _public(doc: dict) -> dict:
    """Strip the hashed password before returning user data to callers."""
    return {
        "id": str(doc.get("id", "")),
        "name": doc.get("name"),
        "username": doc.get("username"),
        "email": doc.get("email"),
        "role": doc.get("role", "user"),
        "profile_pic": doc.get("profile_pic"),
        "org_id": doc.get("org_id"),
        "is_admin": bool(doc.get("is_admin", False)),
    }


def _seed_default_users():
    """Pre-populate a default admin user so login/signup work out of the box."""
    global _memory_users
    if "admin" not in _memory_users and "admin@sorimtechnologies.com" not in _memory_users:
        default_admin = {
            "id": uuid.uuid4().hex,
            "name": "Admin",
            "username": "admin",
            "email": "admin@sorimtechnologies.com",
            "password": hash_password("admin@123"),
            "role": "admin",
            "profile_pic": None,
            "org_id": None,
            "is_admin": True,
            "created_at": datetime.now(timezone.utc),
        }
        _memory_users["admin"] = default_admin
        logger.info("Seeded default admin user (username=admin, password=admin@123)")


async def get_user_by_login(identifier: str) -> Optional[dict[str, Any]]:
    """
    Find a user by email or username.
    Returns the raw document (including hashed password) for auth comparison.
    Returns None if not found.
    """
    store_type, col = _get_store()

    if store_type == "mongo":
        try:
            escaped = re.escape(identifier.strip())
            doc = await col.find_one(
                {
                    "$or": [
                        {"email": {"$regex": f"^{escaped}$", "$options": "i"}},
                        {"username": {"$regex": f"^{escaped}$", "$options": "i"}},
                    ]
                },
                {"_id": 0},
            )
            logger.info("User lookup completed: found=%s", bool(doc))
            return doc or None
        except Exception as exc:
            logger.error(f"get_user_by_login failed: {exc}")
            return None

    # ── In-memory fallback ─────────────────────────────────────────────
    _seed_default_users()
    identifier = identifier.strip().lower()
    for key, doc in _memory_users.items():
        if doc.get("username", "").lower() == identifier or doc.get("email", "").lower() == identifier:
            # Return copy without password for safety
            result = dict(doc)
            return result
    return None


async def authenticate_user(identifier: str, plain_password: str) -> Optional[dict[str, Any]]:
    """
    Verify credentials. Returns public user dict on success, None on failure.
    """
    doc = await get_user_by_login(identifier)
    if not doc:
        return None
    stored = doc.get("password", "")
    # Support both bcrypt-hashed and legacy plain-text passwords
    try:
        ok = verify_password(plain_password, stored)
    except Exception:
        ok = plain_password == stored   # plain-text fallback for dev seeds

    logger.info("Authenticate user completed: user_id_present=%s success=%s", bool(doc.get("id")), ok)
    return _public(doc) if ok else None


async def create_user(
    name: str,
    username: str,
    email: str,
    plain_password: str,
    role: str = "user",
    org_id: Optional[str] = None,
    is_admin: bool = False,
) -> dict[str, Any]:
    """
    Create a new user. Raises ValueError if email/username already exists.
    Returns the public user dict (no password).
    """
    store_type, col = _get_store()

    if store_type == "mongo":
        if await col.find_one({"$or": [{"email": email}, {"username": username}]}):
            raise ValueError("Email or username already registered")

        user = {
            "id": uuid.uuid4().hex,
            "name": name,
            "username": username,
            "email": email,
            "password": hash_password(plain_password),
            "role": role,
            "profile_pic": None,
            "org_id": org_id,
            "is_admin": is_admin,
            "created_at": datetime.now(timezone.utc),
        }
        await col.insert_one(user)
        return _public(user)

    # ── In-memory fallback ─────────────────────────────────────────────
    _seed_default_users()
    # Check for duplicates
    for key, doc in _memory_users.items():
        if doc.get("username", "").lower() == username.lower() or doc.get("email", "").lower() == email.lower():
            raise ValueError("Email or username already registered")

    user = {
        "id": uuid.uuid4().hex,
        "name": name,
        "username": username,
        "email": email,
        "password": hash_password(plain_password),
        "role": role,
        "profile_pic": None,
        "org_id": org_id,
        "is_admin": is_admin,
        "created_at": datetime.now(timezone.utc),
    }
    _memory_users[username] = user
    logger.info("In-memory user created: %s (%s)", username, email)
    return _public(user)


async def set_user_org(user_id: str, org_id: str, is_admin: bool = False) -> None:
    """Assign a user to an org and optionally grant admin rights."""
    store_type, col = _get_store()

    if store_type == "mongo":
        await col.update_one(
            {"id": user_id},
            {"$set": {
                "org_id": org_id,
                "is_admin": is_admin,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return

    # In-memory fallback
    for key, doc in _memory_users.items():
        if doc.get("id") == user_id:
            doc["org_id"] = org_id
            doc["is_admin"] = is_admin
            doc["updated_at"] = datetime.now(timezone.utc)
            return


async def update_password(identifier: str, new_plain_password: str) -> None:
    store_type, col = _get_store()

    if store_type == "mongo":
        await col.update_one(
            {"$or": [{"username": identifier}, {"email": identifier}]},
            {"$set": {
                "password": hash_password(new_plain_password),
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        return

    # In-memory fallback
    identifier_lower = identifier.strip().lower()
    for key, doc in _memory_users.items():
        if doc.get("username", "").lower() == identifier_lower or doc.get("email", "").lower() == identifier_lower:
            doc["password"] = hash_password(new_plain_password)
            doc["updated_at"] = datetime.now(timezone.utc)
            return


async def update_profile_pic(user_id: str, url: str) -> None:
    store_type, col = _get_store()

    if store_type == "mongo":
        await col.update_one(
            {"id": str(user_id)},
            {"$set": {"profile_pic": url, "updated_at": datetime.now(timezone.utc)}},
        )
        return

    # In-memory fallback
    for key, doc in _memory_users.items():
        if doc.get("id") == user_id:
            doc["profile_pic"] = url
            doc["updated_at"] = datetime.now(timezone.utc)
            return