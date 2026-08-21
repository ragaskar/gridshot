"""Bin Profiles Phase 2: gridfinity.py's previously-hardcoded structural
constants (lip profile, wall thickness, corral/grid deck dimensions, magnet
hole edge inset) are now optional parameters, each defaulting to the same
value the module constant used to be. Two guarantees matter here:

1. Omitting a new parameter produces geometry identical to before this
   change (the seeded Bin Profiles, and every untouched single-tool caller,
   depend on this).
2. Passing an explicit override actually changes the geometry it should.
"""

from __future__ import annotations

import pytest

from gridshot.core import gridfinity as grid_mod

TOOL_POCKET = grid_mod.Poly(
    exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]
)


def _vertices(solid) -> object:
    mesh = solid.to_mesh()
    import numpy as np
    return np.asarray(mesh.vert_properties)


class TestDefaultsMatchOmittingTheParameter:
    @pytest.mark.parametrize("lip", [False, True])
    @pytest.mark.parametrize("style", ["pocket", "corral", "grid"])
    def test_bin_solid_explicit_defaults_are_byte_identical(self, style, lip):
        kwargs = dict(
            gx=2, gy=2, height_u=3, pocket=TOOL_POCKET, pocket_depth=5.0,
            style=style, lip=lip,
        )
        if style == "grid":
            kwargs["height_u"] = 4  # grid needs >=2u below the stacking plane
        baseline = grid_mod.bin_solid(**kwargs)
        explicit = grid_mod.bin_solid(
            **kwargs,
            lip_height_mm=grid_mod.LIP_H,
            lip_chamfer_top_mm=grid_mod.LIP_CH_TOP,
            lip_straight_mm=grid_mod.LIP_STRAIGHT,
            lip_chamfer_bottom_mm=grid_mod.LIP_CH_BOT,
            min_wall_mm=grid_mod.MIN_WALL,
            min_floor_mm=grid_mod.MIN_FLOOR,
            corral_floor_mm=grid_mod.CORRAL_FLOOR,
            corral_wall_mm=grid_mod.CORRAL_WALL,
            corral_base_flare_mm=grid_mod.CORRAL_BASE_FLARE,
            corral_base_reinforcement_h_mm=grid_mod.CORRAL_BASE_REINFORCEMENT_H,
            magnet_hole_inset_from_edge_mm=grid_mod.MAGNET_HOLE_INSET_FROM_EDGE_MM,
        )
        assert explicit.volume() == pytest.approx(baseline.volume(), rel=1e-9)
        assert (_vertices(explicit) == _vertices(baseline)).all()

    def test_magnet_holes_explicit_default_inset_is_byte_identical(self):
        kwargs = dict(gx=2, gy=2, height_u=3, magnet_holes=True)
        baseline = grid_mod.bin_solid(**kwargs)
        explicit = grid_mod.bin_solid(
            **kwargs, magnet_hole_inset_from_edge_mm=grid_mod.MAGNET_HOLE_INSET_FROM_EDGE_MM,
        )
        assert explicit.volume() == pytest.approx(baseline.volume(), rel=1e-9)
        assert (_vertices(explicit) == _vertices(baseline)).all()

    def test_height_helpers_explicit_lip_height_matches_default(self):
        assert grid_mod.finished_height_mm(3, lip=True, lip_height_mm=grid_mod.LIP_H) == \
            grid_mod.finished_height_mm(3, lip=True)
        assert grid_mod.height_u_for_overall(30.0, lip=True, lip_height_mm=grid_mod.LIP_H) == \
            grid_mod.height_u_for_overall(30.0, lip=True)

    def test_auto_height_u_explicit_min_floor_matches_default(self):
        assert grid_mod.auto_height_u(5.0, min_floor_mm=grid_mod.MIN_FLOOR) == grid_mod.auto_height_u(5.0)


class TestOverridesChangeGeometry:
    def test_larger_lip_height_makes_a_lipped_bin_taller(self):
        short = grid_mod.bin_solid(2, 2, height_u=3, lip=True, lip_height_mm=4.4)
        tall = grid_mod.bin_solid(2, 2, height_u=3, lip=True, lip_height_mm=8.0)
        assert tall.bounding_box()[5] > short.bounding_box()[5]

    def test_thicker_corral_wall_removes_more_material(self):
        thin = grid_mod.bin_solid(
            3, 3, height_u=4, pocket=TOOL_POCKET, pocket_depth=5.0, style="corral", corral_wall_mm=2.0,
        )
        thick = grid_mod.bin_solid(
            3, 3, height_u=4, pocket=TOOL_POCKET, pocket_depth=5.0, style="corral", corral_wall_mm=6.0,
        )
        assert thick.volume() > thin.volume()

    def test_thicker_corral_floor_adds_material(self):
        thin = grid_mod.bin_solid(
            3, 3, height_u=4, pocket=TOOL_POCKET, pocket_depth=5.0, style="corral", corral_floor_mm=1.2,
        )
        thick = grid_mod.bin_solid(
            3, 3, height_u=4, pocket=TOOL_POCKET, pocket_depth=5.0, style="corral", corral_floor_mm=3.0,
        )
        assert thick.volume() > thin.volume()

    def test_thicker_corral_base_reinforcement_adds_material(self):
        thin = grid_mod.bin_solid(
            3, 3, height_u=4, pocket=TOOL_POCKET, pocket_depth=5.0, style="corral",
            corral_base_reinforcement_h_mm=1.0,
        )
        thick = grid_mod.bin_solid(
            3, 3, height_u=4, pocket=TOOL_POCKET, pocket_depth=5.0, style="corral",
            corral_base_reinforcement_h_mm=3.0,
        )
        assert thick.volume() > thin.volume()

    def test_different_magnet_hole_inset_moves_the_holes(self):
        near_edge = grid_mod.bin_solid(2, 2, height_u=3, magnet_holes=True, magnet_hole_inset_from_edge_mm=4.8)
        near_center = grid_mod.bin_solid(2, 2, height_u=3, magnet_holes=True, magnet_hole_inset_from_edge_mm=10.0)
        # same 4 holes' worth of material removed either way, but at different positions
        assert near_edge.volume() == pytest.approx(near_center.volume(), rel=1e-6)
        assert not (_vertices(near_edge) == _vertices(near_center)).all()

    def test_larger_min_floor_requires_more_clearance_for_the_same_pocket(self):
        # A pocket depth that fits under the default MIN_FLOOR...
        grid_mod.bin_solid(2, 2, height_u=3, pocket=TOOL_POCKET, pocket_depth=15.0, min_floor_mm=grid_mod.MIN_FLOOR)
        # ...no longer fits once min_floor_mm demands more clearance than height_u leaves.
        with pytest.raises(grid_mod.PocketTooDeepError):
            grid_mod.bin_solid(2, 2, height_u=3, pocket=TOOL_POCKET, pocket_depth=15.0, min_floor_mm=6.0)

    def test_thinner_corral_wall_lets_a_narrower_bin_offer_more_grid_sockets(self):
        pockets = [(TOOL_POCKET, 5.0, ())]
        thick_wall = grid_mod.grid_available_cells(4, 4, pockets, corral_wall_mm=6.0, corral_base_flare_mm=0.8)
        thin_wall = grid_mod.grid_available_cells(4, 4, pockets, corral_wall_mm=2.0, corral_base_flare_mm=0.8)
        assert len(thin_wall) >= len(thick_wall)
