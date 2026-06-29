from datetime import datetime, timezone
from typing import Optional

import motor.motor_asyncio

COLLECTION_NAME = "plant_equipment"


async def init_equipment_indexes(db: motor.motor_asyncio.AsyncIOMotorDatabase) -> None:
    await db[COLLECTION_NAME].create_index([("equipment_id", 1)], unique=True)
    await db[COLLECTION_NAME].create_index([("dashboard_scope", 1)])
    await db[COLLECTION_NAME].create_index([("name", 1)])


def make_equipment_id(dashboard_scope: str, equipment_name: str) -> str:
    scope = (dashboard_scope or "enterprise").strip().lower()
    name = (equipment_name or "general").strip().lower().replace(" ", "_")
    return f"{scope}_{name}"


async def upsert_equipment(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    *,
    dashboard_scope: str,
    equipment_name: str,
    document_type: str,
    filename: str,
    source_url: Optional[str] = None,
) -> None:
    now = datetime.now(timezone.utc)
    equipment_id = make_equipment_id(dashboard_scope, equipment_name)
    display_name = (equipment_name or "General").replace("_", " ").title()

    # Check if the filename already exists for this equipment
    existing = await db[COLLECTION_NAME].find_one(
        {"equipment_id": equipment_id, "filenames": filename}
    )

    if existing is None:
        # Filename not found: do a single update_one with $inc doc_count
        await db[COLLECTION_NAME].update_one(
            {"equipment_id": equipment_id},
            {
                "$set": {
                    "equipment_id": equipment_id,
                    "name": (equipment_name or "general").strip().lower(),
                    "display_name": display_name,
                    "dashboard_scope": (dashboard_scope or "enterprise").strip().lower(),
                    "last_updated": now,
                    "source_url": source_url,
                },
                "$addToSet": {
                    "document_types_available": document_type,
                    "filenames": filename,
                },
                "$inc": {
                    "doc_count": 1,
                },
                "$setOnInsert": {
                    "created_at": now,
                },
            },
            upsert=True,
        )
    else:
        # Filename found: do a single update_one without $inc doc_count
        await db[COLLECTION_NAME].update_one(
            {"equipment_id": equipment_id},
            {
                "$set": {
                    "equipment_id": equipment_id,
                    "name": (equipment_name or "general").strip().lower(),
                    "display_name": display_name,
                    "dashboard_scope": (dashboard_scope or "enterprise").strip().lower(),
                    "last_updated": now,
                    "source_url": source_url,
                },
                "$addToSet": {
                    "document_types_available": document_type,
                },
            },
            upsert=True,
        )


async def list_equipment_by_scope(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    dashboard_scope: Optional[str] = None,
) -> list[dict]:
    query = {}
    if dashboard_scope:
        query["dashboard_scope"] = dashboard_scope

    cursor = db[COLLECTION_NAME].find(
        query,
        {"_id": 0, "equipment_id": 1, "name": 1, "display_name": 1, "dashboard_scope": 1, "document_types_available": 1, "doc_count": 1, "last_updated": 1},
    ).sort("name", 1)
    return [doc async for doc in cursor]


async def get_equipment(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    equipment_id: str,
) -> Optional[dict]:
    doc = await db[COLLECTION_NAME].find_one({"equipment_id": equipment_id}, {"_id": 0})
    return doc


async def delete_equipment_if_empty(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    dashboard_scope: str,
    equipment_name: str,
    filename: str,
) -> None:
    equipment_id = make_equipment_id(dashboard_scope, equipment_name)
    await db[COLLECTION_NAME].update_one(
        {"equipment_id": equipment_id},
        {"$pull": {"filenames": filename}, "$inc": {"doc_count": -1}},
    )
    await db[COLLECTION_NAME].delete_one({"equipment_id": equipment_id, "filenames": {"$size": 0}})
