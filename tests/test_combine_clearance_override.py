"""Per-tool clearance override for the multi-tool combine editor: a bin-time
override on `POST /api/library/combine/preview` changes one tool's effective
clearance without touching its library value, the same way finger-hole
overrides already work."""

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


def _seed_tool(**overrides) -> library_mod.LibraryTool:
    kwargs = dict(id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0)
    kwargs.update(overrides)
    return library_mod.save(library_mod.LibraryTool(**kwargs))


def _seed_two_tools(clearance_mm: float = 1.0):
    _seed_tool(clearance_mm=clearance_mm)
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        clearance_mm=clearance_mm,
    ))


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


class TestCombineClearanceOverride:
    def test_no_override_uses_library_value(self, client, library_dir):
        _seed_two_tools(clearance_mm=1.0)

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["clearance_mm"] == 1.0
        assert tool_a["clearance_mm_inherited"] == 1.0
        assert tool_a["clearance_mm_override"] is None

    def test_override_changes_effective_clearance_for_one_tool_only(self, client, library_dir):
        _seed_two_tools(clearance_mm=1.0)

        response = _preview(client, overrides=[{"id": "tool-a", "clearance_mm": 3.5}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["clearance_mm"] == 3.5
        assert by_id["tool-a"]["clearance_mm_override"] == 3.5
        assert by_id["tool-a"]["clearance_mm_inherited"] == 1.0
        assert by_id["tool-b"]["clearance_mm"] == 1.0
        assert by_id["tool-b"]["clearance_mm_override"] is None

    def test_override_actually_grows_the_pocket_geometry(self, client, library_dir):
        _seed_two_tools(clearance_mm=1.0)

        baseline = _preview(client).json()
        overridden = _preview(client, overrides=[{"id": "tool-a", "clearance_mm": 10.0}]).json()

        def bbox_width(preview, tool_id):
            stamp = next(t for t in preview["tools"] if t["id"] == tool_id)["stamp"]
            xs = [p[0] for p in stamp]
            return max(xs) - min(xs)

        assert bbox_width(overridden, "tool-a") > bbox_width(baseline, "tool-a")

    def test_negative_clearance_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "clearance_mm": -1.0}])

        assert response.status_code == 422

    def test_explicit_null_reverts_to_library_value(self, client, library_dir):
        _seed_two_tools(clearance_mm=1.0)

        response = _preview(client, overrides=[{"id": "tool-a", "clearance_mm": None}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["clearance_mm"] == 1.0
        assert tool_a["clearance_mm_override"] is None
