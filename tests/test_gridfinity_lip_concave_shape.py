"""Stacking lip on a concave custom bin shape (a shape with grid cells
removed that notches into the outer boundary).

_lip_ring's 45deg chamfer transitions were built as `Manifold.batch_hull`
between two plates of the same (possibly concave) outline at different
insets — exact for a plain rounded rect (always convex), but a convex hull
of two plates that both carry the same concave notch can't have a
concavity: it bridges straight across the notch with a flat diagonal face,
carving the lip's inner cavity too aggressively near that corner and
leaving an unsupported overhang there. Reported as a Bambu Studio "floating
cantilever" warning on a real bin (force_gx=6, force_gy=5,
removed_cells=[(0,2),(0,3),(0,4)], lip=True) that print-sliced cleanly with
lip=False.
"""

from __future__ import annotations

import numpy as np
import pytest

from gridshot.core import gridfinity as grid_mod


def _longest_diagonal_edge_mm(polygon: np.ndarray) -> float:
    """Longest edge of a closed polygon that moves substantially in *both*
    x and y — a straight hull-bridge-over-a-notch shows up as one very long
    diagonal edge; a boundary that actually follows a notch's corners does
    not, regardless of how long its (axis-aligned) straight walls are."""
    nxt = np.roll(polygon, -1, axis=0)
    dx = np.abs(nxt[:, 0] - polygon[:, 0])
    dy = np.abs(nxt[:, 1] - polygon[:, 1])
    diagonal = (dx > 10) & (dy > 10)
    if not diagonal.any():
        return 0.0
    return float(np.hypot(dx[diagonal], dy[diagonal]).max())


class TestIsConvex:
    def test_a_full_grid_outline_is_convex(self):
        outline = grid_mod._rounded_polyomino_outline(3, 2, None)
        assert grid_mod._is_convex(outline)

    def test_a_notched_custom_shape_is_not_convex(self):
        included = frozenset({(0, 1), (1, 0), (1, 1)})  # L-shape, missing (0,0)
        outline = grid_mod._rounded_polyomino_outline(2, 2, included)
        assert not grid_mod._is_convex(outline)


class TestChamferTransition:
    """_chamfer_transition is what _lip_ring calls to build each 45°
    chamfer — tested directly here since "the final solid is a valid
    manifold" (already covered by test_gridfinity_custom_bin_shape.py)
    doesn't catch this bug: the over-carved cavity is still a well-formed
    subtraction, just geometrically wrong."""

    def test_plain_rect_chamfer_has_no_diagonal_bridge(self):
        outline = grid_mod._rounded_polyomino_outline(3, 2, None)
        chamfer = grid_mod._chamfer_transition(
            outline, grid_mod.LIP_RIM_FLAT, 10.0, grid_mod.LIP_CH_TOP, 8.0,
        )
        polygon = np.array(chamfer.project().to_polygons()[0])
        assert _longest_diagonal_edge_mm(polygon) < 1.0

    def test_notched_shape_chamfer_follows_the_notch_instead_of_bridging_it(self):
        gx, gy = 6, 5
        removed = {(0, 4), (0, 3), (0, 2)}
        included = frozenset(
            (ix, iy) for ix in range(gx) for iy in range(gy) if (ix, iy) not in removed
        )
        outline = grid_mod._rounded_polyomino_outline(gx, gy, included)
        assert not grid_mod._is_convex(outline)

        chamfer = grid_mod._chamfer_transition(
            outline, grid_mod.LIP_RIM_FLAT, 10.0, grid_mod.LIP_CH_TOP, 8.0,
        )
        polygon = np.array(chamfer.project().to_polygons()[0])
        # Before the fix this was a single ~133mm diagonal edge bridging
        # straight from (-125, -24) to (-83, 102), straight across the
        # removed-cells notch.
        assert _longest_diagonal_edge_mm(polygon) < 1.0


class TestBinSolidConcaveLip:
    def test_notched_shape_with_lip_is_a_single_watertight_solid(self):
        gx, gy = 6, 5
        removed = {(0, 4), (0, 3), (0, 2)}
        included = frozenset(
            (ix, iy) for ix in range(gx) for iy in range(gy) if (ix, iy) not in removed
        )
        solid = grid_mod.bin_solid(
            gx, gy, height_u=6, lip=True, included_cells=included,
            fill_height_pct=100.0, live_grid=False,
        )
        assert solid.status().name == "NoError"
        assert len(solid.decompose()) == 1
        mesh = grid_mod.to_trimesh(solid)
        assert mesh.is_watertight
        assert mesh.is_winding_consistent

    def test_notched_shape_lip_keeps_more_material_than_a_hull_bridged_cavity_would(self):
        """A hull-bridged cavity carves away extra material near the notch
        corner it shouldn't reach — the fixed lip should retain more net
        volume over the lipless body than that, not less."""
        included = frozenset({(0, 1), (1, 0), (1, 1)})  # L-shape, missing (0,0)
        with_lip = grid_mod.bin_solid(2, 2, height_u=3, lip=True, included_cells=included)
        no_lip = grid_mod.bin_solid(2, 2, height_u=3, lip=False, included_cells=included)
        lip_added_volume = with_lip.volume() - no_lip.volume()

        # Same shape, but forcing the (buggy) hull path via a hand-rolled
        # chamfer, to get a same-run baseline instead of a hardcoded
        # magic number.
        outline = grid_mod._rounded_polyomino_outline(2, 2, included)

        def hull_chamfer(inset_a, z_a, inset_b, z_b):
            def rr(inset):
                return outline.offset(-inset, grid_mod.JoinType.Round, circular_segments=grid_mod.CIRCULAR_SEGMENTS)
            def plate(inset, z):
                return grid_mod.Manifold.extrude(rr(inset), grid_mod.EPS).translate((0, 0, z))
            return grid_mod.Manifold.batch_hull([plate(inset_a, z_a), plate(inset_b, z_b)])

        assert grid_mod._is_convex(outline) is False
        hull_upper_area = hull_chamfer(
            grid_mod.LIP_RIM_FLAT, 10.0, grid_mod.LIP_CH_TOP, 8.0,
        ).project().area()
        fixed_upper_area = grid_mod._chamfer_transition(
            outline, grid_mod.LIP_RIM_FLAT, 10.0, grid_mod.LIP_CH_TOP, 8.0,
        ).project().area()
        # The hull's footprint bridges the notch, so it covers strictly
        # more area than the true (concavity-respecting) chamfer.
        assert hull_upper_area > fixed_upper_area
        assert lip_added_volume > 0
