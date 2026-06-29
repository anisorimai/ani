import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.documents import _derive_unit_tags, _parse_upload_path


def test_derive_unit_tags_from_path_segments():
    tags = _derive_unit_tags("Manufacturing/Granulator/SOP.pdf")
    assert tags == ["Manufacturing"]

    tags = _derive_unit_tags("QC/Validation/Deviation.pdf")
    assert tags == ["QC"]


def test_parse_upload_path_keeps_equipment_anchor():
    equipment, filename = _parse_upload_path("Granulator/SOP.pdf")
    assert equipment == "Granulator"
    assert filename == "SOP.pdf"
