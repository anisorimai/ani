import re
from dataclasses import dataclass
from pathlib import Path


_SCOPE_MAP = {
    "production": "production",
    "quality":    "quality",
    "qc":         "quality",
    "qa":         "quality",
    "qaqc":       "quality",
    "enterprise": "enterprise",
    "general":    "enterprise",
    "plant":      "enterprise",
}

_DOCTYPE_PATTERNS = [
    (r"manual|user guide|operation|operator|sop|procedure|protocol", "manual"),
    (r"datasheet|data sheet|spec|specification", "datasheet"),
    (r"catalogue|catalog", "catalogue"),
    (r"brochure|flyer|overview", "brochure"),
    (r"report|summary|record|log|validation|qualification|iq|oq|pq", "report"),
]


@dataclass
class ParsedUploadPath:
    dashboard_scope: str
    equipment_name: str
    document_type: str
    filename: str
    storage_key: str
    is_equipment_specific: bool


def _infer_document_type(filename: str) -> str:
    stem = Path(filename).stem.lower().replace("_", " ").replace("-", " ")
    for pattern, document_type in _DOCTYPE_PATTERNS:
        if re.search(pattern, stem):
            return document_type
    return "manual"


def parse_upload_path(raw_path: str) -> ParsedUploadPath:
    normalized = (raw_path or "").replace("\\", "/").strip("/")
    parts = [part for part in normalized.split("/") if part]

    if len(parts) >= 3:
        scope = _SCOPE_MAP.get(parts[0].strip().lower(), "enterprise")
        equipment_name = parts[1].strip()
        filename = parts[-1]
        is_equipment_specific = True
    elif len(parts) == 2:
        first = parts[0].strip().lower()
        if first in _SCOPE_MAP:
            scope = _SCOPE_MAP[first]
            equipment_name = "General"
            filename = parts[1]
            is_equipment_specific = False
        else:
            scope = "enterprise"
            equipment_name = parts[0].strip()
            filename = parts[1]
            is_equipment_specific = True
    else:
        scope = "enterprise"
        equipment_name = "General"
        filename = parts[0] if parts else "document.pdf"
        is_equipment_specific = False

    document_type = _infer_document_type(filename)
    if is_equipment_specific:
        storage_key = f"{scope}/{equipment_name}/{filename}"
    elif scope == "enterprise":
        storage_key = f"enterprise/{filename}"
    else:
        storage_key = f"{scope}/{filename}"

    return ParsedUploadPath(
        dashboard_scope=scope,
        equipment_name=equipment_name,
        document_type=document_type,
        filename=filename,
        storage_key=storage_key,
        is_equipment_specific=is_equipment_specific,
    )
