"""
Data ingestion — scans DATA_DIR for CSV/JSON files and loads them into MongoDB.

Rules:
- Collection name = filename without extension (e.g. quality_dashboard.csv → quality_dashboard)
- Skips a collection if it already has documents (idempotent — safe to call on every startup)
- Converts numeric strings to float/int automatically
- Internal collections (users, chats, sessions, rag_chunks) are never touched
"""

import csv
import json
import logging
from pathlib import Path

from config.settings import DATA_DIR

logger = logging.getLogger("voxa.data_ingestion")

_SKIP_COLLECTIONS = {"users", "chats", "sessions", "rag_chunks"}


def _coerce(value: str):
    """Try to parse value as int, then float, then return as-is string."""
    v = value.strip()
    if v == "":
        return None
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


async def _ingest_csv(db, path: Path) -> int:
    collection_name = path.stem
    if collection_name in _SKIP_COLLECTIONS:
        logger.info("Skipping internal collection: %s", collection_name)
        return 0

    coll = db[collection_name]
    existing = await coll.count_documents({})
    if existing > 0:
        logger.info("Collection '%s' already has %d docs — skipping", collection_name, existing)
        return 0

    records = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append({k: _coerce(v) for k, v in row.items()})

    if not records:
        logger.warning("CSV '%s' is empty — nothing inserted", path.name)
        return 0

    result = await coll.insert_many(records)
    logger.info("Inserted %d records into '%s' from %s", len(result.inserted_ids), collection_name, path.name)
    return len(result.inserted_ids)


async def _ingest_json(db, path: Path) -> int:
    collection_name = path.stem
    if collection_name in _SKIP_COLLECTIONS:
        return 0

    coll = db[collection_name]
    existing = await coll.count_documents({})
    if existing > 0:
        logger.info("Collection '%s' already has %d docs — skipping", collection_name, existing)
        return 0

    with path.open(encoding="utf-8-sig") as f:
        data = json.load(f)

    records = data if isinstance(data, list) else [data]
    if not records:
        return 0

    result = await coll.insert_many(records)
    logger.info("Inserted %d records into '%s' from %s", len(result.inserted_ids), collection_name, path.name)
    return len(result.inserted_ids)


async def ingest_directory(db) -> dict[str, int]:
    """
    Scan DATA_DIR for CSV and JSON files, ingest each into the matching
    MongoDB collection. Returns a dict of {collection_name: records_inserted}.
    """
    data_dir = Path(DATA_DIR)
    if not data_dir.exists():
        logger.warning("DATA_DIR '%s' does not exist — skipping ingestion", data_dir)
        return {}

    counts: dict[str, int] = {}

    for path in sorted(data_dir.iterdir()):
        if not path.is_file():
            continue
        try:
            if path.suffix.lower() == ".csv":
                n = await _ingest_csv(db, path)
            elif path.suffix.lower() == ".json":
                n = await _ingest_json(db, path)
            else:
                continue
            if n:
                counts[path.stem] = n
        except Exception as exc:
            logger.error("Failed to ingest '%s': %s", path.name, exc)

    return counts
