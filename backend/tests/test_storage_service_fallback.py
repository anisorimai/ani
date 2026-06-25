import importlib
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def test_verify_storage_falls_back_to_local_when_supabase_unavailable(monkeypatch, tmp_path):
    import services.storage_service as storage_service

    importlib.reload(storage_service)

    monkeypatch.setattr(storage_service, "STORAGE_BACKEND", "supabase")
    monkeypatch.setattr(storage_service, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage_service, "SUPABASE_SERVICE_ROLE_KEY", "secret")
    monkeypatch.setattr(storage_service, "SUPABASE_STORAGE_BUCKET", "plant_documents")
    monkeypatch.setattr(storage_service, "SUPABASE_PUBLIC_BASE_URL", "")
    monkeypatch.setattr(storage_service, "DATA_DIR", tmp_path)
    monkeypatch.setattr(storage_service, "_storage_service", None)

    class FakeSupabaseStorageService:
        def __init__(self, *args, **kwargs):
            self.client = type(
                "FakeClient",
                (),
                {"storage": type(
                    "FakeStorage",
                    (),
                    {"get_bucket": lambda self, bucket_name: (_ for _ in ()).throw(RuntimeError("boom"))},
                )()},
            )()

    monkeypatch.setattr(storage_service, "SupabaseStorageService", FakeSupabaseStorageService)

    storage_service.verify_storage()
    service = storage_service.get_storage_service()
    assert isinstance(service, storage_service.LocalStorageService)
