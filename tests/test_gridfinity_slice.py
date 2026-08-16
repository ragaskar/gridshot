"""slice_layer: a thin, full-width horizontal coupon cropped from a bin solid,
so a pocket/recess trace can be test-printed without the whole bin. Cutouts
are single constant-section extrusions (no draft/taper), so a slice anywhere
within a cutout's depth range must expose the identical cross-section."""

from __future__ import annotations

import pytest

from gridshot.core import gridfinity as grid_mod
from gridshot.core.models import Poly


def _square_pocket(w: float, d: float) -> Poly:
    return Poly(
        exterior=[(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    )


@pytest.fixture
def pocket_bin():
    depth = 6.0
    height_u = 3
    pocket = _square_pocket(20.0, 15.0)
    solid = grid_mod.bin_solid(2, 1, height_u, pocket=pocket, pocket_depth=depth)
    total_h = height_u * grid_mod.UNIT_H
    floor_z = total_h - depth
    return solid, floor_z, depth, total_h


class TestSliceLayer:
    def test_slice_spans_exactly_the_requested_z_range(self, pocket_bin):
        solid, floor_z, depth, _ = pocket_bin
        z0 = floor_z + depth / 2 - grid_mod.SLICE_THICKNESS_MM / 2

        sliced = grid_mod.slice_layer(solid, z0)

        mesh = grid_mod.to_trimesh(sliced)
        zmin, zmax = mesh.bounds[:, 2]
        assert zmin == pytest.approx(z0, abs=1e-6)
        assert zmax - zmin == pytest.approx(grid_mod.SLICE_THICKNESS_MM, abs=1e-6)

    def test_slice_inside_the_pocket_exposes_the_hole(self, pocket_bin):
        """A slice within the pocket's depth range has less material than an
        equally thick slice taken below the pocket (solid floor region)."""
        solid, floor_z, depth, _ = pocket_bin

        within_pocket = grid_mod.slice_layer(
            solid, floor_z + depth / 2 - grid_mod.SLICE_THICKNESS_MM / 2
        )
        below_pocket = grid_mod.slice_layer(solid, grid_mod.BASE_H + 0.2)

        assert (
            grid_mod.to_trimesh(within_pocket).volume
            < grid_mod.to_trimesh(below_pocket).volume
        )

    def test_cross_section_is_constant_across_the_pocket_depth(self, pocket_bin):
        """No taper: slices near the floor and near the open top of the same
        pocket must have equal volume."""
        solid, floor_z, depth, total_h = pocket_bin
        thickness = grid_mod.SLICE_THICKNESS_MM

        near_floor = grid_mod.slice_layer(solid, floor_z + 0.1)
        near_top = grid_mod.slice_layer(solid, total_h - thickness - 0.1)

        v1 = grid_mod.to_trimesh(near_floor).volume
        v2 = grid_mod.to_trimesh(near_top).volume
        assert v1 == pytest.approx(v2, rel=1e-6)


class TestSliceWindow:
    def test_single_pocket_is_centred_in_its_depth(self):
        z0, thickness = grid_mod.slice_window(21.0, [6.0])

        assert thickness == pytest.approx(grid_mod.SLICE_THICKNESS_MM)
        floor_z = 21.0 - 6.0
        assert floor_z <= z0
        assert z0 + thickness <= 21.0

    def test_multiple_pockets_land_within_every_pockets_range(self):
        """Different tools in one combined bin can have different recess
        depths; the window must still land inside each one, since every
        pocket opens straight through to the top."""
        total_h = 21.0
        depths = [6.0, 9.0, 4.0]

        z0, thickness = grid_mod.slice_window(total_h, depths)

        for depth in depths:
            floor_z = total_h - depth
            assert floor_z <= z0
            assert z0 + thickness <= total_h

    def test_shallowest_pocket_governs_the_window(self):
        """Widening one pocket's depth shouldn't move the window — it's
        pinned to the shallowest one, the binding constraint."""
        total_h = 21.0

        narrow = grid_mod.slice_window(total_h, [3.0])
        widened = grid_mod.slice_window(total_h, [3.0, 20.0])

        assert narrow == widened

    def test_pocket_shallower_than_default_thickness_is_clamped_not_skipped(self):
        z0, thickness = grid_mod.slice_window(21.0, [0.6])

        assert thickness == pytest.approx(0.6)
        assert z0 == pytest.approx(21.0 - 0.6)

    def test_pocket_too_shallow_to_print_returns_none(self):
        assert grid_mod.slice_window(21.0, [0.2]) is None

    def test_no_pockets_returns_none(self):
        assert grid_mod.slice_window(21.0, []) is None
