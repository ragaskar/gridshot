"""Magnet-hole settings round-trip through the library: a saved tool remembers
them, PATCH can change them, and derive_tool_spec (used by every regenerate
path — combine, drawer export, compose preview) carries them through."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import gridfinity as grid_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_OUTLINE = Poly(
    exterior=[(-30.0, -10.0), (30.0, -10.0), (30.0, 10.0), (-30.0, 10.0)]
)


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _seed_tool(**overrides) -> library_mod.LibraryTool:
    kwargs = dict(id="tool-a", label="Wrench", outline=TOOL_OUTLINE, thickness_mm=4.0)
    kwargs.update(overrides)
    return library_mod.save(library_mod.LibraryTool(**kwargs))


class TestLibraryMagnetHoles:
    def test_defaults_match_the_gridfinity_spec(self, library_dir):
        tool = _seed_tool()

        assert tool.magnet_holes is False
        assert tool.magnet_hole_diameter_mm == grid_mod.MAGNET_HOLE_DIAMETER_MM
        assert tool.magnet_hole_depth_mm == grid_mod.MAGNET_HOLE_DEPTH_MM

    def test_patch_enables_and_configures_magnet_holes(self, client, library_dir):
        _seed_tool()

        response = client.patch(
            "/api/library/tool-a",
            json={
                "magnet_holes": True,
                "magnet_hole_diameter_mm": 5.0,
                "magnet_hole_depth_mm": 1.5,
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["magnet_holes"] is True
        assert body["magnet_hole_diameter_mm"] == 5.0
        assert body["magnet_hole_depth_mm"] == 1.5

    def test_derive_tool_spec_carries_the_setting_through(self, library_dir):
        tool = _seed_tool(
            magnet_holes=True, magnet_hole_diameter_mm=5.0, magnet_hole_depth_mm=1.5,
        )

        spec = library_mod.derive_tool_spec(tool)

        assert spec.magnet_holes is True
        assert spec.magnet_hole_diameter_mm == 5.0
        assert spec.magnet_hole_depth_mm == 1.5

    def test_disabled_by_default_for_a_tool_with_no_magnet_settings(
        self, library_dir
    ):
        tool = _seed_tool()

        spec = library_mod.derive_tool_spec(tool)

        assert spec.magnet_holes is False
