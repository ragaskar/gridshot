"""A toolshape placed in a bin behaves like any other tool through the
combine pipeline: its per-tool params surface in the preview response (for
the inspector to edit), and the fillet-bottom option builds a real mesh."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import bintools as bintools_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

OTHER_OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _make_toolshape(fillet_bottom: bool = False):
    return bintools_mod.create_toolshape(
        "rounded_rect", width_mm=30.0, length_mm=30.0, radius_mm=1.0,
        fillet_bottom=fillet_bottom,
    )


def _seed_other_tool() -> library_mod.LibraryTool:
    # /combine needs >= 2 tools with outlines; this is the plain second one.
    return library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=OTHER_OUTLINE, thickness_mm=4.0,
    ))


class TestCombinePreview:
    def test_toolshape_params_appear_on_the_combined_tool(self, client, config_dir):
        tool = _make_toolshape(fillet_bottom=True)
        other = _seed_other_tool()

        response = client.post("/api/library/combine/preview", json={
            "ids": [tool.id, other.id], "fill_height_pct": 100.0,
        })

        assert response.status_code == 200
        combined = {t["id"]: t for t in response.json()["tools"]}[tool.id]
        assert combined["toolshape_type"] == "rounded_rect"
        assert combined["toolshape_width_mm"] == 30.0
        assert combined["toolshape_length_mm"] == 30.0
        assert combined["toolshape_radius_mm"] == 1.0
        assert combined["toolshape_fillet_bottom"] is True

    def test_a_plain_tool_has_no_toolshape_type(self, client, config_dir):
        tool = _make_toolshape()
        other = _seed_other_tool()

        response = client.post("/api/library/combine/preview", json={
            "ids": [tool.id, other.id], "fill_height_pct": 100.0,
        })

        combined = {t["id"]: t for t in response.json()["tools"]}[other.id]
        assert combined["toolshape_type"] is None
        assert combined["toolshape_fillet_bottom"] is False


class TestCombineGlb:
    def test_builds_a_mesh_with_fillet_bottom_on(self, client, config_dir):
        tool = _make_toolshape(fillet_bottom=True)
        other = _seed_other_tool()

        response = client.post("/api/library/combine/preview.glb", json={
            "ids": [tool.id, other.id], "fill_height_pct": 100.0,
        })

        assert response.status_code == 200
        assert response.headers["content-type"] == "model/gltf-binary"
        assert len(response.content) > 0

    def test_builds_a_mesh_with_fillet_bottom_off(self, client, config_dir):
        tool = _make_toolshape(fillet_bottom=False)
        other = _seed_other_tool()

        response = client.post("/api/library/combine/preview.glb", json={
            "ids": [tool.id, other.id], "fill_height_pct": 100.0,
        })

        assert response.status_code == 200
