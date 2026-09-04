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


class TestMagnetCornersOnly:
    """`magnet_corners_only` cuts a hole only where a foot corner is a convex
    corner of the bin's own footprint — see gridfinity._magnet_corner_signs
    and docs/magnet-holes.md."""

    def _included(self, gx, gy, missing):
        return frozenset(
            (x, y) for x in range(gx) for y in range(gy) if (x, y) not in missing
        )

    def test_disabled_leaves_the_solid_unchanged_by_corners_only_alone(self):
        """magnet_corners_only is a no-op unless magnet_holes is also on."""
        off = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 2, 3, magnet_corners_only=True)
        ).volume
        plain = grid_mod.to_trimesh(grid_mod.bin_solid(2, 2, 3)).volume

        assert off == pytest.approx(plain)

    def test_plain_rectangle_gets_exactly_one_hole_per_outer_corner(self):
        """A plain gx*gy rectangle has exactly 4 outer corners, regardless of
        how many feet it has — vs. 4 holes per foot when corners_only is off."""
        gx, gy = 2, 2
        plain = grid_mod.to_trimesh(grid_mod.bin_solid(gx, gy, 3)).volume
        corners_only = grid_mod.to_trimesh(
            grid_mod.bin_solid(gx, gy, 3, magnet_holes=True, magnet_corners_only=True)
        ).volume
        every_corner = grid_mod.to_trimesh(
            grid_mod.bin_solid(gx, gy, 3, magnet_holes=True, magnet_corners_only=False)
        ).volume

        radius = grid_mod.MAGNET_HOLE_DIAMETER_MM / 2
        one_hole = math.pi * radius**2 * grid_mod.MAGNET_HOLE_DEPTH_MM

        assert (plain - corners_only) == pytest.approx(4 * one_hole, rel=0.02)
        assert (plain - every_corner) == pytest.approx(gx * gy * 4 * one_hole, rel=0.02)

    def test_worked_example_one_notched_corner_cell(self):
        """3x3 grid missing its (2, 0) corner cell: the notch exposes two new
        convex corners (one on each neighbour of the missing cell) in
        addition to the rectangle's 3 untouched corners — 5 magnet corners
        total, none of them doubled up on one cell."""
        included = self._included(3, 3, {(2, 0)})

        totals = {
            cell: grid_mod._magnet_corner_signs(cell[0], cell[1], 3, 3, included)
            for cell in included
        }
        nonzero = {cell: signs for cell, signs in totals.items() if signs}

        assert sum(len(signs) for signs in totals.values()) == 5
        assert set(nonzero) == {(0, 0), (1, 0), (2, 1), (0, 2), (2, 2)}
        assert all(len(signs) == 1 for signs in nonzero.values())

    def test_worked_example_two_notches_leave_a_middle_bridge(self):
        """4x3 grid missing (3, 0), (0, 1), (3, 1): the two end columns each
        get a doubled-up corner (2 magnets, one per exposed edge) on the
        surviving cell that used to be a full corner; the single-cell bridge
        cells in the middle row end up fully interior/concave and get none."""
        included = self._included(4, 3, {(3, 0), (0, 1), (3, 1)})

        totals = {
            cell: grid_mod._magnet_corner_signs(cell[0], cell[1], 4, 3, included)
            for cell in included
        }
        nonzero = {cell: signs for cell, signs in totals.items() if signs}

        assert sum(len(signs) for signs in totals.values()) == 7
        assert set(nonzero) == {(0, 0), (2, 0), (0, 2), (3, 2)}
        assert len(totals[(0, 0)]) == 2
        assert len(totals[(2, 0)]) == 1
        assert len(totals[(0, 2)]) == 2
        assert len(totals[(3, 2)]) == 2
        assert totals[(1, 1)] == []
        assert totals[(2, 1)] == []


class TestMagnetEasyRelease:
    """"off"/"auto"/"inner"/"outer" — a narrow pry groove cut beside each
    magnet hole, matching gridfinity_extended's `magnet_release()`. "auto"
    resolves to "inner" (this codebase has no "efficient floor" concept, the
    case upstream's own auto rule maps to "inner")."""

    def test_off_leaves_the_solid_unchanged(self):
        plain = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True)
        ).volume
        explicit_off = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release="off")
        ).volume

        assert explicit_off == pytest.approx(plain)

    def test_off_is_a_noop_when_magnet_holes_is_off(self):
        plain = grid_mod.to_trimesh(grid_mod.bin_solid(2, 1, 3)).volume
        released = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_easy_release="outer")
        ).volume

        assert released == pytest.approx(plain)

    @pytest.mark.parametrize("value", ["auto", "inner", "outer"])
    def test_removes_more_material_than_a_plain_hole(self, value):
        plain_holes = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True)
        ).volume
        with_release = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release=value)
        ).volume

        assert with_release < plain_holes

    def test_auto_matches_inner(self):
        auto = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release="auto")
        ).volume
        inner = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release="inner")
        ).volume

        assert auto == pytest.approx(inner)

    def test_inner_and_outer_remove_the_same_volume(self):
        """Same tail shape, just mirrored per corner — same total volume."""
        inner = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release="inner")
        ).volume
        outer = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release="outer")
        ).volume

        assert inner == pytest.approx(outer)

    def test_still_watertight_and_manifold(self):
        for value in ("inner", "outer"):
            solid = grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release=value)
            mesh = grid_mod.to_trimesh(solid)
            assert mesh.is_watertight
            assert mesh.is_winding_consistent

    def test_stays_inside_the_foot_bottom_footprint(self):
        tail_reach = (
            grid_mod.MAGNET_HOLE_OFFSET_MM
            + grid_mod.MAGNET_HOLE_DIAMETER_MM / 2
            + grid_mod.MAGNET_EASY_RELEASE_LENGTH_MM
        )
        assert tail_reach < grid_mod.FOOT_BOTTOM_SIZE / 2

    def test_unknown_value_is_rejected(self):
        with pytest.raises(ValueError, match="magnet_easy_release"):
            grid_mod.bin_solid(2, 1, 3, magnet_holes=True, magnet_easy_release="sideways")

    def test_honours_corners_only(self):
        plain = grid_mod.to_trimesh(grid_mod.bin_solid(2, 2, 3)).volume
        corners_only = grid_mod.to_trimesh(
            grid_mod.bin_solid(
                2, 2, 3, magnet_holes=True, magnet_corners_only=True,
                magnet_easy_release="outer",
            )
        ).volume
        every_corner = grid_mod.to_trimesh(
            grid_mod.bin_solid(
                2, 2, 3, magnet_holes=True, magnet_corners_only=False,
                magnet_easy_release="outer",
            )
        ).volume

        assert plain > corners_only > every_corner
