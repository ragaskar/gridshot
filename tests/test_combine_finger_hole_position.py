"""Per-tool finger-hole side/position override for the multi-tool combine
editor: bin-time `finger_hole_side_flip`/`finger_hole_offset_mm` overrides on
`POST /api/library/combine/preview`, same shape as the clearance override."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

# Wide relative to its height, so the default finger hole lands on a named
# side ("top"/"bottom") rather than the interior representative-point anchor.
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
    def test_default_response_reports_the_side_and_offset_bound(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_side"] in ("top", "bottom", "left", "right")
        assert tool_a["finger_hole_offset_mm_max"] > 0
        assert tool_a["finger_hole_side_flip"] is False
        assert tool_a["finger_hole_offset_mm"] == 0
        assert tool_a["finger_hole_side_flip_override"] is None
        assert tool_a["finger_hole_offset_mm_override"] is None

    def test_side_flip_override_mirrors_the_hole_for_one_tool_only(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")
        base_b = next(t for t in baseline["tools"] if t["id"] == "tool-b")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_side_flip": True}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["finger_hole_side_flip"] is True
        assert by_id["tool-a"]["finger_hole_side"] != base_a["finger_hole_side"]
        assert by_id["tool-b"]["finger_hole_side_flip"] is False
        assert by_id["tool-b"]["finger_hole_side"] == base_b["finger_hole_side"]

    def test_offset_override_moves_the_finger_hole(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_offset_mm": 5.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_offset_mm"] == 5.0
        assert tool_a["finger_hole_offset_mm_override"] == 5.0
        assert tool_a["finger_holes"] != base_a["finger_holes"]
