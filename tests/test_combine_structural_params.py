"""Bin Profiles Phase 3: the 12 structural overrides (lip profile, wall
thickness, floor thickness, general-fill/tool-wall dimensions, magnet hole
edge inset) now flow all the way from CombineRequest through
_combine_layout/_combine_solid, and round-trip through Bin Library
save/reopen. See tests/test_gridfinity_profile_params.py for the
geometry-layer guarantees this builds on."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import gridfinity as grid_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])
TOOL_B_OUTLINE = Poly(exterior=[(-8.0, -4.0), (8.0, -4.0), (8.0, 4.0), (-8.0, 4.0)])


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


STRUCTURAL_OVERRIDES = {
    "lip_height_mm": 8.0,
    "lip_chamfer_top_mm": 2.5,
    "lip_straight_mm": 2.0,
    "lip_chamfer_bottom_mm": 1.0,
    "min_wall_mm": 3.0,
    "min_floor_mm": 2.0,
    "floor_thickness_mm": 2.0,
    "tool_wall_mm": 4.0,
    "tool_wall_flare_mm": 1.5,
    "tool_wall_reinforcement_h_mm": 2.0,
    "edge_margin_mm": 2.0,
    "magnet_hole_inset_from_edge_mm": 8.0,
}


class TestPreviewReflectsStructuralOverrides:
    def test_omitting_structural_fields_matches_explicit_defaults(self, client, library_dir):
        _seed_two_tools()
        defaults = {
            "lip_height_mm": grid_mod.LIP_H,
            "lip_chamfer_top_mm": grid_mod.LIP_CH_TOP,
            "lip_straight_mm": grid_mod.LIP_STRAIGHT,
            "lip_chamfer_bottom_mm": grid_mod.LIP_CH_BOT,
            "min_wall_mm": grid_mod.MIN_WALL,
            "min_floor_mm": grid_mod.MIN_FLOOR,
            "floor_thickness_mm": grid_mod.FLOOR_THICKNESS,
            "tool_wall_mm": grid_mod.TOOL_WALL,
            "tool_wall_flare_mm": grid_mod.TOOL_WALL_FLARE,
            "tool_wall_reinforcement_h_mm": grid_mod.TOOL_WALL_REINFORCEMENT_H,
            "edge_margin_mm": grid_mod.EDGE_MARGIN,
            "magnet_hole_inset_from_edge_mm": grid_mod.MAGNET_HOLE_INSET_FROM_EDGE_MM,
        }
        omitted = _preview(client, lip=True).json()
        explicit = _preview(client, lip=True, **defaults).json()

        assert omitted["overall_height_mm"] == explicit["overall_height_mm"]
        assert omitted["wall"] == explicit["wall"]

    def test_larger_lip_height_increases_overall_height(self, client, library_dir):
        _seed_two_tools()
        default = _preview(client, lip=True).json()
        overridden = _preview(client, lip=True, lip_height_mm=8.0).json()

        assert overridden["overall_height_mm"] > default["overall_height_mm"]

    def test_thicker_tool_wall_increases_the_reported_wall(self, client, library_dir):
        _seed_two_tools()
        default = _preview(client, fill_height_pct=0).json()
        overridden = _preview(
            client, fill_height_pct=0, tool_wall_mm=8.0, tool_wall_flare_mm=2.0,
        ).json()

        assert overridden["wall"] > default["wall"]

    def test_thicker_min_wall_increases_the_reported_wall_for_a_lipless_shell(self, client, library_dir):
        _seed_two_tools()
        default = _preview(client, fill_height_pct=0, lip=False).json()
        overridden = _preview(client, fill_height_pct=0, lip=False, min_wall_mm=10.0).json()

        assert overridden["wall"] > default["wall"]


class TestBinLibrarySaveReopenRoundTrip:
    def test_structural_overrides_are_saved_and_echoed_back(self, client, library_dir):
        _seed_two_tools()

        response = client.post(
            "/api/bins",
            json={"ids": ["tool-a", "tool-b"], "label": "Custom Style", **STRUCTURAL_OVERRIDES},
        )

        assert response.status_code == 200
        body = response.json()
        for key, value in STRUCTURAL_OVERRIDES.items():
            assert body[key] == pytest.approx(value)

        listed = client.get("/api/bins").json()["bins"][0]
        for key, value in STRUCTURAL_OVERRIDES.items():
            assert listed[key] == pytest.approx(value)

    def test_a_bin_saved_without_structural_overrides_omits_them(self, client, library_dir):
        _seed_two_tools()

        response = client.post("/api/bins", json={"ids": ["tool-a", "tool-b"], "label": "Plain"})

        assert response.status_code == 200
        body = response.json()
        assert body["lip_height_mm"] is None
        assert body["min_wall_mm"] is None

    def test_exporting_a_saved_bin_with_structural_overrides_succeeds(self, client, library_dir):
        _seed_two_tools()
        bin_id = client.post(
            "/api/bins",
            json={"ids": ["tool-a", "tool-b"], "label": "Custom Style", **STRUCTURAL_OVERRIDES},
        ).json()["id"]

        response = client.post(f"/api/bins/{bin_id}/export")

        assert response.status_code == 200
        assert response.headers["content-type"] == "model/3mf"
        assert len(response.content) > 0
