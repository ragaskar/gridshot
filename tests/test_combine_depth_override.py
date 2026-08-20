"""Per-tool pocket-depth override for the multi-tool combine editor: a
bin-time override on `POST /api/library/combine/preview` changes one tool's
effective pocket depth without touching its library value, the same way
clearance/finger-hole overrides already work."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(
    exterior=[(-30.0, -10.0), (30.0, -10.0), (30.0, 10.0), (-30.0, 10.0)]
)
TOOL_B_OUTLINE = Poly(
    exterior=[(-15.0, -8.0), (15.0, -8.0), (15.0, 8.0), (-15.0, 8.0)]
)


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
    ))
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
    ))


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


class TestCombineDepthOverride:
    def test_no_override_uses_automatic_depth(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["depth_mm"] == tool_a["depth_mm_inherited"]
        assert tool_a["depth_mm_override"] is None
        assert tool_a["depth_mode"] == "automatic"

    def test_override_changes_effective_depth_for_one_tool_only(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": 5.0}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["depth_mm"] == 5.0
        assert by_id["tool-a"]["depth_mm_override"] == 5.0
        assert by_id["tool-a"]["depth_mode"] == "override"
        assert by_id["tool-a"]["depth_mm_inherited"] != 5.0
        assert by_id["tool-b"]["depth_mm_override"] is None
        assert by_id["tool-b"]["depth_mode"] == "automatic"

    def test_deep_override_grows_the_bin_height(self, client, library_dir):
        _seed_two_tools()

        baseline = _preview(client).json()
        overridden = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": 20.0}]).json()

        assert overridden["gx"] == baseline["gx"] and overridden["gy"] == baseline["gy"]
        assert overridden["overall_height_mm"] > baseline["overall_height_mm"]

    def test_zero_depth_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": 0.0}])

        assert response.status_code == 422

    def test_negative_depth_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": -1.0}])

        assert response.status_code == 422

    def test_explicit_null_reverts_to_automatic_depth(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": None}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["depth_mm_override"] is None
        assert tool_a["depth_mode"] == "automatic"

    def test_override_on_tool_with_library_depth_shows_override_not_library_override(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
            pocket_depth_mm=6.0,
        ))
        library_mod.save(library_mod.LibraryTool(
            id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        ))

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": 8.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["depth_mm"] == 8.0
        assert tool_a["depth_mm_inherited"] == 6.0
        assert tool_a["depth_mode"] == "override"
