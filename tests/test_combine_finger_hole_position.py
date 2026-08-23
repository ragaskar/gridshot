"""Per-tool finger-hole position override for the multi-tool combine editor:
a bin-time `finger_hole_arc_mm` override on `POST /api/library/combine/preview`,
same shape as the clearance override — arc-length in mm along the pocket
outline, wrapped mod its perimeter."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(exterior=[(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)])
TOOL_B_OUTLINE = Poly(exterior=[(-15.0, -4.0), (15.0, -4.0), (15.0, 4.0), (-15.0, 4.0)])


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _seed_two_tools():
    library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
        finger_hole=True,
    ))
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        finger_hole=True,
    ))


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


class TestCombineFingerHolePosition:
    def test_default_response_reports_a_resolved_arc_length_and_no_override(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_arc_mm"] >= 0
        assert tool_a["finger_hole_arc_mm_override"] is None

    def test_arc_override_moves_the_finger_hole_for_one_tool_only(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")
        base_b = next(t for t in baseline["tools"] if t["id"] == "tool-b")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_arc_mm": 10.0}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["finger_hole_arc_mm"] == 10.0
        assert by_id["tool-a"]["finger_hole_arc_mm_override"] == 10.0
        assert by_id["tool-a"]["finger_holes"] != base_a["finger_holes"]
        assert by_id["tool-b"]["finger_hole_arc_mm_override"] is None
        assert by_id["tool-b"]["finger_holes"] == base_b["finger_holes"]

    def test_arc_override_wraps_around_the_perimeter(self, client, library_dir):
        _seed_two_tools()
        # perimeter of tool-a's pocket is close to, but not exactly, the raw
        # outline's 2*(38+10)=96mm once clearance/compensation apply — derive
        # from the response itself rather than hard-coding it.
        baseline = _preview(client, overrides=[{"id": "tool-a", "finger_hole_arc_mm": 0.0}]).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")

        # A very large arc-length must still resolve (wrap, not error).
        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_arc_mm": 10_000.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_arc_mm"] >= 0
        assert tool_a["finger_holes"] != base_a["finger_holes"]

    def test_legacy_override_fields_still_move_the_hole_when_no_arc_is_set(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_offset_mm": 5.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_arc_mm_override"] is None
        assert tool_a["finger_holes"] != base_a["finger_holes"]


class TestCombineFingerHoleDiameter:
    def test_default_diameter_is_20mm_and_no_override(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_holes"][0][2] == pytest.approx(20.0)
        assert tool_a["finger_hole_diameter_mm_override"] is None

    def test_diameter_override_resizes_one_tool_only(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_b = next(t for t in baseline["tools"] if t["id"] == "tool-b")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_diameter_mm": 30.0}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["finger_holes"][0][2] == pytest.approx(30.0)
        assert by_id["tool-a"]["finger_hole_diameter_mm_override"] == pytest.approx(30.0)
        assert by_id["tool-a"]["finger_hole_diameter_mm_inherited"] == pytest.approx(20.0)
        assert by_id["tool-b"]["finger_hole_diameter_mm_override"] is None
        assert by_id["tool-b"]["finger_holes"] == base_b["finger_holes"]
