"""bin_solid magnet holes: one 6.5mm-diameter, 2mm-deep hole (by default) at
each corner of every foot, matching the gridfinity.xyz spec placement."""

from __future__ import annotations

import math

import pytest

from gridshot.core import gridfinity as grid_mod


def _plain_bin(gx=2, gy=1, height_u=3):
    return grid_mod.bin_solid(gx, gy, height_u)


class TestMagnetHoles:
    def test_disabled_by_default_leaves_the_solid_unchanged(self):
        with_default = grid_mod.bin_solid(2, 1, 3)
        explicit_off = grid_mod.bin_solid(2, 1, 3, magnet_holes=False)

        assert grid_mod.to_trimesh(with_default).volume == pytest.approx(
            grid_mod.to_trimesh(explicit_off).volume
        )

    def test_enabling_removes_material(self):
        plain = grid_mod.to_trimesh(_plain_bin()).volume
        holed = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True)
        ).volume

        assert holed < plain

    def test_removes_four_holes_per_foot(self):
        """gx*gy feet × 4 corners × cylinder volume, within discretization
        tolerance of the polygonal (not ideal-circle) cylinder approximation."""
        gx, gy = 2, 1
        plain = grid_mod.to_trimesh(_plain_bin(gx, gy)).volume
        holed = grid_mod.to_trimesh(
            grid_mod.bin_solid(gx, gy, 3, magnet_holes=True)
        ).volume
        removed = plain - holed

        radius = grid_mod.MAGNET_HOLE_DIAMETER_MM / 2
        one_hole = math.pi * radius**2 * grid_mod.MAGNET_HOLE_DEPTH_MM
        expected = gx * gy * 4 * one_hole

        assert removed == pytest.approx(expected, rel=0.02)

    def test_custom_diameter_and_depth_are_honoured(self):
        plain = grid_mod.to_trimesh(_plain_bin()).volume
        holed = grid_mod.to_trimesh(
            grid_mod.bin_solid(
                2, 1, 3,
                magnet_holes=True,
                magnet_hole_diameter_mm=4.0,
                magnet_hole_depth_mm=1.0,
            )
        ).volume
        removed = plain - holed

        expected = 2 * 1 * 4 * math.pi * 2.0**2 * 1.0
        assert removed == pytest.approx(expected, rel=0.02)

    def test_holes_land_inside_the_foot_bottom_footprint(self):
        """The hole offset from the foot centre must stay within the foot's
        bottom face, or the cut would break out of the foot entirely."""
        assert grid_mod.MAGNET_HOLE_OFFSET_MM < grid_mod.FOOT_BOTTOM_SIZE / 2

    def test_depth_at_or_beyond_the_foot_height_is_rejected(self):
        with pytest.raises(ValueError, match="foot height"):
            grid_mod.bin_solid(
                2, 1, 3, magnet_holes=True,
                magnet_hole_depth_mm=grid_mod.BASE_H,
            )

    def test_nonpositive_diameter_is_rejected(self):
        with pytest.raises(ValueError, match="diameter"):
            grid_mod.bin_solid(
                2, 1, 3, magnet_holes=True, magnet_hole_diameter_mm=0.0,
            )

    def test_nonpositive_depth_is_rejected(self):
        with pytest.raises(ValueError, match="depth"):
            grid_mod.bin_solid(
                2, 1, 3, magnet_holes=True, magnet_hole_depth_mm=0.0,
            )
