"""Per-tool "auto" (100% of the bin's usable height) and "percentage" pocket
depth modes for the multi-tool combine editor. Unlike the pre-existing
"automatic" depth (each tool's own measured full height + margin,
independent of bin height), "auto" and "percentage" resolve fresh against
the bin's *current* usable height on every request — the same span the
"bin height" arrange-page control (docs/combine-editor-bin-height.md) shows
as USABLE."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import gridfinity as grid_mod
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


def _seed_two_tools(*, thickness_a=4.0, thickness_b=12.0):
    library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=thickness_a,
    ))
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=thickness_b,
    ))


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


def _by_id(response):
    return {t["id"]: t for t in response.json()["tools"]}


class TestAutoDepthFillsTheBin:
    def test_two_differently_sized_auto_tools_get_the_same_depth(self, client, library_dir):
        # Different `thickness_mm` used to drive different "automatic"
        # depths (own full height + margin) before this feature — now both
        # are "auto" (no override, no persisted pocket_depth_mm/pct), so
        # both must resolve to the *same* depth: 100% of the bin's usable
        # height, regardless of their own physical size.
        _seed_two_tools(thickness_a=4.0, thickness_b=12.0)

        response = _preview(client, overall_height=39.4)  # -> height_u=5, lip on by default

        assert response.status_code == 200
        by_id = _by_id(response)
        assert by_id["tool-a"]["depth_kind"] == "auto"
        assert by_id["tool-b"]["depth_kind"] == "auto"
        assert by_id["tool-a"]["depth_mm"] == by_id["tool-b"]["depth_mm"]
        assert by_id["tool-a"]["depth_mm"] == pytest.approx(response.json()["usable_height_mm"], abs=0.06)

    def test_auto_depth_matches_reported_usable_height(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overall_height=39.4)

        meta = response.json()
        by_id = _by_id(response)
        expected = round(
            grid_mod.usable_height_for_overall(
                meta["overall_height_mm"], True,
                floor_thickness_mm=grid_mod.FLOOR_THICKNESS, lip_height_mm=grid_mod.LIP_H,
            ),
            2,
        )
        assert by_id["tool-a"]["depth_mm"] == pytest.approx(expected, abs=0.1)
        assert meta["usable_height_mm"] == pytest.approx(expected, abs=0.1)


class TestPercentageDepth:
    def test_override_percentage_is_half_of_usable_height(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client, overall_height=39.4,
            overrides=[{"id": "tool-a", "pocket_depth_pct": 50.0}],
        )

        assert response.status_code == 200
        by_id = _by_id(response)
        assert by_id["tool-a"]["depth_kind"] == "percentage"
        assert by_id["tool-a"]["depth_mm"] == pytest.approx(
            response.json()["usable_height_mm"] / 2, abs=0.06,
        )
        # Unaffected: tool-b stays "auto" (100%).
        assert by_id["tool-b"]["depth_kind"] == "auto"
        assert by_id["tool-b"]["depth_mm"] == pytest.approx(response.json()["usable_height_mm"], abs=0.06)

    def test_persisted_percentage_on_the_tool_itself_is_honoured(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
            pocket_depth_pct=25.0,
        ))
        library_mod.save(library_mod.LibraryTool(
            id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        ))

        response = _preview(client, overall_height=39.4)

        by_id = _by_id(response)
        assert by_id["tool-a"]["depth_kind"] == "percentage"
        assert by_id["tool-a"]["depth_mm"] == pytest.approx(
            response.json()["usable_height_mm"] * 0.25, abs=0.06,
        )

    def test_fixed_depth_always_wins_over_a_persisted_percentage(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
            pocket_depth_mm=9.0, pocket_depth_pct=25.0,
        ))
        library_mod.save(library_mod.LibraryTool(
            id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        ))

        response = _preview(client)

        by_id = _by_id(response)
        assert by_id["tool-a"]["depth_kind"] == "fixed"
        assert by_id["tool-a"]["depth_mm"] == 9.0

    def test_percentage_over_100_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_pct": 150.0}])

        assert response.status_code == 422

    def test_percentage_of_zero_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_pct": 0.0}])

        assert response.status_code == 422


class TestFixedToolsForceAMinimumHeight:
    def test_fixed_tool_forces_min_height_u_even_when_auto_tools_would_need_less(self, client, library_dir):
        _seed_two_tools(thickness_a=1.0, thickness_b=1.0)  # both tiny, "auto" would need almost nothing

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": 30.0}])

        meta = response.json()
        by_id = _by_id(response)
        expected_min_u = grid_mod.auto_height_u(30.0)
        assert meta["min_height_u"] == expected_min_u
        assert meta["height_u"] >= expected_min_u
        # tool-b is still "auto" — it fills 100% of the *resulting* bin,
        # not its own tiny natural depth.
        assert by_id["tool-b"]["depth_kind"] == "auto"
        assert by_id["tool-b"]["depth_mm"] == pytest.approx(meta["usable_height_mm"], abs=0.06)

    def test_requested_height_below_the_fixed_minimum_is_clamped_up(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client, overall_height=14.0,  # far too short for a 30mm-deep fixed pocket
            overrides=[{"id": "tool-a", "pocket_depth_mm": 30.0}],
        )

        meta = response.json()
        assert meta["height_u"] == grid_mod.auto_height_u(30.0)
        assert meta["height_u"] > grid_mod.height_u_for_overall(14.0, True, grid_mod.LIP_H)

    def test_no_fixed_tools_reports_min_height_u_of_one(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.json()["min_height_u"] == 1


class TestDivergentFloorAndMinFloor:
    """A Bin Profile can set floor_thickness_mm and min_floor_mm to
    different values (see docs/combine-editor-bin-height.md). An "auto"
    tool must never resolve to a depth bin_solid's own min_floor_mm check
    would then reject as too deep."""

    def test_auto_depth_respects_the_larger_of_floor_thickness_and_min_floor(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client, overall_height=39.4,
            floor_thickness_mm=0.5, min_floor_mm=1.2,
        )

        assert response.status_code == 200
        by_id = _by_id(response)
        meta = response.json()
        total_h = meta["overall_height_mm"] - grid_mod.LIP_H  # lip on by default
        max_safe_depth = total_h - grid_mod.BASE_H - 1.2
        assert by_id["tool-a"]["depth_mm"] <= max_safe_depth + 0.01
        assert by_id["tool-b"]["depth_mm"] <= max_safe_depth + 0.01

    def test_auto_depth_respects_floor_thickness_when_it_is_the_larger_value(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client, overall_height=39.4,
            floor_thickness_mm=2.5, min_floor_mm=1.2,
        )

        assert response.status_code == 200
        by_id = _by_id(response)
        meta = response.json()
        total_h = meta["overall_height_mm"] - grid_mod.LIP_H
        max_safe_depth = total_h - grid_mod.BASE_H - 2.5
        assert by_id["tool-a"]["depth_mm"] <= max_safe_depth + 0.01
        assert by_id["tool-b"]["depth_mm"] <= max_safe_depth + 0.01

    def test_auto_tool_at_partial_fill_height_pct_does_not_error(self, client, library_dir):
        # The non-fast (general) construction path in bin_solid has its own
        # depth guard (deck_top = BASE_H + floor_thickness_mm) — a 100%-fill
        # auto tool must still land safely inside it.
        _seed_two_tools()

        response = _preview(client, overall_height=39.4, fill_height_pct=50)

        assert response.status_code == 200
        by_id = _by_id(response)
        assert by_id["tool-a"]["depth_kind"] == "auto"
        assert by_id["tool-a"]["depth_mm"] > 0


class TestEffectiveDepthPctInResponse:
    """`depth_pct` in the response must reflect the *effective* percentage
    (this request's override, or the persisted one) — not always the
    persisted value, which stays None for a request-scoped override and
    would silently make the UI's input default back to 100%."""

    def test_depth_pct_reflects_a_request_scoped_override(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_pct": 50.0}])

        tool_a = _by_id(response)["tool-a"]
        assert tool_a["depth_pct"] == 50.0
        assert tool_a["depth_pct_override"] == 50.0

    def test_depth_pct_reflects_a_persisted_percentage_with_no_override(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
            pocket_depth_pct=25.0,
        ))
        library_mod.save(library_mod.LibraryTool(
            id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        ))

        response = _preview(client)

        tool_a = _by_id(response)["tool-a"]
        assert tool_a["depth_pct"] == 25.0
        assert tool_a["depth_pct_override"] is None

    def test_depth_pct_is_null_for_auto_and_fixed_tools(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "pocket_depth_mm": 9.0}])

        by_id = _by_id(response)
        assert by_id["tool-a"]["depth_kind"] == "fixed"
        assert by_id["tool-a"]["depth_pct"] is None
        assert by_id["tool-b"]["depth_kind"] == "auto"
        assert by_id["tool-b"]["depth_pct"] is None


class TestPercentageSurvivesSaveAndReopen:
    """A saved bin's overrides are its own recipe, separate from CombineRequest
    — pocket_depth_pct needs its own field on SavedBinOverride or it's
    silently dropped by pydantic on save, and any percentage-mode tool comes
    back as Auto the next time the bin is opened."""

    def test_percentage_override_survives_a_save_and_reopen_round_trip(self, client, library_dir):
        _seed_two_tools()

        saved = client.post("/api/bins", json={
            "ids": ["tool-a", "tool-b"], "label": "Percentage Bin",
            "overrides": [{"id": "tool-a", "pocket_depth_pct": 50.0}],
        }).json()

        reopened = client.get("/api/bins").json()["bins"][0]
        override = next(o for o in reopened["overrides"] if o["id"] == saved["tool_ids"][0])
        assert override["pocket_depth_pct"] == 50.0
