"""
Async MongoDB client using Motor.

Provides a single shared connection via get_db().
connect_db() / close_db() are called from the FastAPI lifespan context.
"""

import logging
from typing import Optional

import motor.motor_asyncio

from config.settings import MONGO_URI, MONGO_DB_NAME

logger = logging.getLogger("voxa.database")

_client: Optional[motor.motor_asyncio.AsyncIOMotorClient] = None
_db: Optional[motor.motor_asyncio.AsyncIOMotorDatabase] = None


async def connect_db() -> None:
    """Open the MongoDB connection. Called once at startup."""
    global _client, _db
    if not MONGO_URI:
        logger.warning("MONGO_URI not set — database unavailable")
        return
    try:
        _client = motor.motor_asyncio.AsyncIOMotorClient(
            MONGO_URI,
            serverSelectionTimeoutMS=5000,
            tls=True,
            tlsAllowInvalidCertificates=True,
        )
        await _client.admin.command("ping")
        _db = _client[MONGO_DB_NAME]
        logger.info(f"Connected to MongoDB: {MONGO_DB_NAME}")
    except Exception as exc:
        logger.error(f"MongoDB connection failed: {exc}")
        _client = None
        _db = None


async def close_db() -> None:
    """Close the MongoDB connection. Called once at shutdown."""
    global _client
    if _client:
        _client.close()
        logger.info("MongoDB connection closed")


def get_db() -> Optional[motor.motor_asyncio.AsyncIOMotorDatabase]:
    """Return the shared database handle (None if not connected)."""
    return _db


def is_connected() -> bool:
    return _db is not None
