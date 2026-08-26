"""Toolshapes: parametric, no-photo tool outlines generated in code (see
gridshot/core/bintools.py `create_toolshape`). The rounded rectangle is the
first one — this covers its outline generator and its optional pocket-
bottom fillet in bin_solid."""

from __future__ import annotations

import math

import pytest

from gridshot.core import gridfinity as grid_mod
from gridshot.core.contour import to_shapely
from gridshot.core.models import Poly


class TestRoundedRectOutline:
    def test_bbox_matches_width_and_length(self):
        shape = to_shapely(grid_mod.toolshape_rounded_rect_outline(30.0, 20.0, 1.0))
        minx, miny, maxx, maxy = shape.bounds
        assert maxx - minx == pytest.approx(30.0, abs=0.05)
        assert maxy - miny == pytest.approx(20.0, abs=0.05)

    def test_centered_at_the_origin(self):
        shape = to_shapely(grid_mod.toolshape_rounded_rect_outline(30.0, 20.0, 1.0))
        assert shape.centroid.x == pytest.approx(0.0, abs=1e-6)
        assert shape.centroid.y == pytest.approx(0.0, abs=1e-6)

    def test_zero_radius_is_a_plain_rectangle(self):
        shape = to_shapely(grid_mod.toolshape_rounded_rect_outline(30.0, 20.0, 0.0))
        assert shape.area == pytest.approx(30.0 * 20.0, rel=1e-3)

    def test_positive_radius_rounds_the_corners_away(self):
        sharp_area = 30.0 * 20.0
        rounded_area = to_shapely(
            grid_mod.toolshape_rounded_rect_outline(30.0, 20.0, 4.0)
        ).area
        assert rounded_area < sharp_area

    def test_radius_larger_than_half_the_short_side_is_clamped(self):
        # Matches _rounded_rect_polygon's own clamp: on a square, an
        # oversized radius degenerates to (near) a circle of r = side/2.
        shape = to_shapely(grid_mod.toolshape_rounded_rect_outline(10.0, 10.0, 100.0))
        assert shape.area == pytest.approx(math.pi * 5.0 ** 2, rel=0.02)

    def test_rejects_nonpositive_width_or_length(self):
        with pytest.raises(ValueError):
            grid_mod.toolshape_rounded_rect_outline(0.0, 10.0, 1.0)
        with pytest.raises(ValueError):
            grid_mod.toolshape_rounded_rect_outline(10.0, -1.0, 1.0)

    def test_rejects_negative_radius(self):
        with pytest.raises(ValueError):
            grid_mod.toolshape_rounded_rect_outline(10.0, 10.0, -1.0)


def _square_pocket(size: float = 20.0) -> Poly:
    half = size / 2
    return Poly(exterior=[(-half, -half), (half, -half), (half, half), (-half, half)])


def _bin_with_pocket(depth: float = 10.0, fillet_radius: float | None = None, size: float = 20.0):
    entry = (_square_pocket(size), depth, (), None, fillet_radius)
    return grid_mod.bin_solid(2, 1, 3, pockets=[entry])


class TestPocketBottomFillet:
    def test_none_matches_omitting_the_field_entirely(self):
        with_none = grid_mod.to_trimesh(_bin_with_pocket(fillet_radius=None)).volume
        four_tuple = grid_mod.to_trimesh(
            grid_mod.bin_solid(2, 1, 3, pockets=[(_square_pocket(), 10.0, (), None)])
        ).volume
        assert with_none == pytest.approx(four_tuple)

    def test_a_positive_radius_removes_additional_material(self):
        plain = grid_mod.to_trimesh(_bin_with_pocket(fillet_radius=None)).volume
        filleted = grid_mod.to_trimesh(_bin_with_pocket(fillet_radius=1.5)).volume
        assert filleted < plain

    def test_a_bigger_radius_removes_more_material(self):
        small = grid_mod.to_trimesh(_bin_with_pocket(fillet_radius=0.5)).volume
        big = grid_mod.to_trimesh(_bin_with_pocket(fillet_radius=2.0)).volume
        assert big < small

    def test_radius_beyond_the_pocket_depth_is_clamped_not_fatal(self):
        solid = grid_mod.to_trimesh(_bin_with_pocket(depth=2.0, fillet_radius=50.0))
        assert solid.volume > 0

    def test_falsy_zero_radius_behaves_like_no_fillet(self):
        zero = grid_mod.to_trimesh(_bin_with_pocket(fillet_radius=0.0)).volume
        none = grid_mod.to_trimesh(_bin_with_pocket(fillet_radius=None)).volume
        assert zero == pytest.approx(none)
