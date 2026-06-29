from rag.path_parser import parse_upload_path
from rag.retriever import apply_scope_boost
from routers.documents import _derive_unit_tags


def test_derive_unit_tags_from_path_segments():
    tags = _derive_unit_tags("Manufacturing/Granulator/SOP.pdf")
    assert tags == ["Manufacturing"]

    tags = _derive_unit_tags("QC/Validation/Deviation.pdf")
    assert tags == ["QC"]


def test_parse_upload_path_keeps_equipment_anchor():
    parsed = parse_upload_path("Granulator/SOP.pdf")
    assert parsed.equipment_name == "Granulator"
    assert parsed.filename == "SOP.pdf"


def test_apply_scope_boost_prefers_quality_over_manufacturing():
    candidates = [
        {"score": 0.90, "metadata": {"dashboard_scope": "manufacturing", "equipment": "Granulator"}},
        {"score": 0.82, "metadata": {"dashboard_scope": "quality", "equipment": "Granulator"}},
    ]

    boosted = apply_scope_boost(candidates, "manufacturing")

    assert boosted[0]["metadata"]["dashboard_scope"] == "quality"
    assert boosted[0]["boosted_by_scope"] == "quality"
