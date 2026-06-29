"""
File storage service — local disk or Supabase Storage.
Switch backends with STORAGE_BACKEND=local|supabase in .env.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import logging

try:
    from supabase import create_client
except Exception:
    create_client = None

from config.settings import (
    DATA_DIR,
    STORAGE_BACKEND,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET,
    SUPABASE_PUBLIC_BASE_URL,
)

logger = logging.getLogger("voxa.storage")


@dataclass
class StoredObject:
    key: str
    url: str
    size: int
    updated_at: Optional[datetime] = None


class LocalStorageService:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_bytes(self, key: str, data: bytes, content_type: Optional[str] = None) -> StoredObject:
        path = self.base_dir / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return StoredObject(
            key=key,
            url=f"/uploads/{key.replace(chr(92), '/')}",
            size=len(data),
            updated_at=datetime.now(timezone.utc),
        )

    def get_bytes(self, key: str) -> bytes:
        path = self.base_dir / key
        if not path.exists():
            raise FileNotFoundError(f"Storage key not found: {key}")
        return path.read_bytes()

    def delete(self, key: str) -> None:
        path = self.base_dir / key
        if path.exists():
            path.unlink()

    def list_prefix(self, prefix: str = "") -> list[StoredObject]:
        root = self.base_dir / prefix
        if not root.exists():
            return []
        items: list[StoredObject] = []
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            rel = p.relative_to(self.base_dir).as_posix()
            stat = p.stat()
            items.append(StoredObject(
                key=rel,
                url=f"/uploads/{rel}",
                size=int(stat.st_size),
                updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            ))
        items.sort(key=lambda x: x.updated_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return items


class SupabaseStorageService:
    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        bucket: str,
        public_base_url: str = "",
    ) -> None:
        if create_client is None:
            raise RuntimeError("supabase package not installed.")
        if not supabase_url or not service_role_key or not bucket:
            raise ValueError("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET are required.")
        self.client = create_client(supabase_url, service_role_key)
        self.bucket = bucket
        self.public_base_url = (public_base_url or "").rstrip("/")

    def _url(self, key: str) -> str:
        if self.public_base_url:
            return f"{self.public_base_url}/{key}"
        return str(self.client.storage.from_(self.bucket).get_public_url(key))

    def save_bytes(self, key: str, data: bytes, content_type: Optional[str] = None) -> StoredObject:
        opts = {"upsert": "true"}
        if content_type:
            opts["content-type"] = content_type
        self.client.storage.from_(self.bucket).upload(path=key, file=data, file_options=opts)
        return StoredObject(key=key, url=self._url(key), size=len(data), updated_at=datetime.now(timezone.utc))

    def get_bytes(self, key: str) -> bytes:
        return self.client.storage.from_(self.bucket).download(key)

    def delete(self, key: str) -> None:
        self.client.storage.from_(self.bucket).remove([key])

    def list_prefix(self, prefix: str = "") -> list[StoredObject]:
        folder = str(Path(prefix).parent).replace("\\", "/")
        rows = self.client.storage.from_(self.bucket).list(path=folder if folder != "." else "")
        items: list[StoredObject] = []
        for row in rows or []:
            name = str(row.get("name") or "")
            if not name:
                continue
            key = f"{folder}/{name}".lstrip("/")
            size = int(row.get("metadata", {}).get("size") or 0)
            updated_raw = row.get("updated_at") or row.get("created_at")
            updated = None
            if isinstance(updated_raw, str):
                try:
                    updated = datetime.fromisoformat(updated_raw.replace("Z", "+00:00"))
                except Exception:
                    pass
            items.append(StoredObject(key=key, url=self._url(key), size=size, updated_at=updated))
        items.sort(key=lambda x: x.updated_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return items


_storage_service = None


def verify_storage() -> None:
    global _storage_service
    if STORAGE_BACKEND != "supabase":
        return

    try:
        service = SupabaseStorageService(
            supabase_url=SUPABASE_URL,
            service_role_key=SUPABASE_SERVICE_ROLE_KEY,
            bucket=SUPABASE_STORAGE_BUCKET,
            public_base_url=SUPABASE_PUBLIC_BASE_URL,
        )
        service.client.storage.get_bucket(SUPABASE_STORAGE_BUCKET)
        logger.info("Supabase storage verified and ready")
        _storage_service = service
    except Exception as exc:
        logger.error("Supabase storage verification failed: %s", exc)
        raise exc


def get_storage_service():
    global _storage_service
    if _storage_service is not None:
        return _storage_service

    if STORAGE_BACKEND == "supabase":
        _storage_service = SupabaseStorageService(
            supabase_url=SUPABASE_URL,
            service_role_key=SUPABASE_SERVICE_ROLE_KEY,
            bucket=SUPABASE_STORAGE_BUCKET,
            public_base_url=SUPABASE_PUBLIC_BASE_URL,
        )
        logger.info("Storage backend: supabase")
        return _storage_service

    _storage_service = LocalStorageService(base_dir=DATA_DIR / "uploads")
    logger.info("Storage backend: local")
    return _storage_service
