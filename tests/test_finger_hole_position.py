"""Continuous finger-hole placement: `BinSettings.finger_hole_arc_mm` places
the hole at that arc-length along the pocket outline's exterior ring (wrapped
mod the ring's total length). `None` (never explicitly positioned) falls back
to the deprecated `finger_hole_side_flip`/`finger_hole_offset_mm` bbox-edge
model — kept only so an existing saved tool/bin's hole resolves to the exact
point it always had. Exercises `derive_bin_spec` directly against hand-built
outlines — no library/route fixtures needed for the geometry math itself."""

from __future__ import annotations

import math

import pytest
from shapely.geometry import Point

from gridshot.core import bench as bench_mod
from gridshot.core import contour as contour_mod
from gridshot.core import derive as derive_mod
from gridshot.core.models import Poly

# A simple rectangle, easy to hand-verify arc-length positions against:
# perimeter = 2*(38+10) = 96mm, exterior starts at (-19,-5) going
# counter-clockwise (matches _align_for_bin's output winding for this shape).
WIDE_OUTLINE = Poly(exterior=[(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)])

# An L-bracket whose default (legacy-fallback) finger hole falls back to the
# interior representative-point anchor, far from every bbox edge.
L_BRACKET_OUTLINE = Poly(
    exterior=[(0, 0), (60, 0), (60, 20), (20, 20), (20, 60), (0, 60)]
)


@pytest.fixture
def printer():
    return bench_mod.default_profile()


def _spec(outline: Poly, **settings_kwargs) -> derive_mod.DerivedBinSpec:
    tool = derive_mod.ToolGeometry(outline=outline, silhouette_height_mm=5.0)
    settings = derive_mod.BinSettings(finger_hole=True, **settings_kwargs)
    return derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())


class TestFingerHoleArcLength:
    def test_arc_mm_zero_lands_on_the_ring_start_vertex(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)

        ring = derive_mod._ring_points(contour_mod.to_shapely(spec.pocket_poly))
        x, y, _ = spec.finger_holes[0]
        assert math.isclose(x, ring[0][0], abs_tol=1e-6)
        assert math.isclose(y, ring[0][1], abs_tol=1e-6)
        assert spec.finger_hole_arc_mm == pytest.approx(0.0)

    def test_arc_mm_moves_the_hole_along_the_boundary(self, printer):
        a = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        b = _spec(WIDE_OUTLINE, finger_hole_arc_mm=10.0)

        ax, ay, _ = a.finger_holes[0]
        bx, by, _ = b.finger_holes[0]
        assert (ax, ay) != pytest.approx((bx, by))

        pocket_shape = contour_mod.to_shapely(b.pocket_poly)
        assert pocket_shape.exterior.distance(Point(bx, by)) < 0.1

    def test_arc_mm_wraps_around_the_perimeter(self, printer):
        pocket_shape = contour_mod.to_shapely(_spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0).pocket_poly)
        perimeter = derive_mod._ring_length(derive_mod._ring_points(pocket_shape))

        at_zero = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        at_full_lap = _spec(WIDE_OUTLINE, finger_hole_arc_mm=perimeter)
        at_negative = _spec(WIDE_OUTLINE, finger_hole_arc_mm=-5.0)
        at_five = _spec(WIDE_OUTLINE, finger_hole_arc_mm=perimeter - 5.0)

        assert at_zero.finger_holes[0][:2] == pytest.approx(at_full_lap.finger_holes[0][:2], abs=1e-6)
        assert at_negative.finger_holes[0][:2] == pytest.approx(at_five.finger_holes[0][:2], abs=1e-6)

    def test_non_finite_arc_mm_is_rejected(self, printer):
        tool = derive_mod.ToolGeometry(outline=WIDE_OUTLINE, silhouette_height_mm=5.0)
        settings = derive_mod.BinSettings(finger_hole=True, finger_hole_arc_mm=float("nan"))

        with pytest.raises(ValueError):
            derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())


class TestLegacyFingerHoleFallback:
    """`finger_hole_arc_mm=None` (the default) — an existing saved tool/bin
    whose hole was never explicitly repositioned must keep resolving to
    exactly the point the old side/flip/offset algorithm always gave it."""

    def test_default_lands_on_the_boundary_and_reports_its_arc_length(self, printer):
        spec = _spec(WIDE_OUTLINE)

        assert spec.finger_hole_arc_mm >= 0.0
        x, y, _ = spec.finger_holes[0]
        pocket_shape = contour_mod.to_shapely(spec.pocket_poly)
        assert pocket_shape.exterior.distance(Point(x, y)) < 0.1

        # Re-deriving with that reported arc-length explicitly must land on
        # the exact same point — the migration guarantee this fallback exists
        # for: an old tool/bin's hole never silently moves the first time the
        # new field happens to be read back.
        pinned = _spec(WIDE_OUTLINE, finger_hole_arc_mm=spec.finger_hole_arc_mm)
        assert pinned.finger_holes[0][:2] == pytest.approx(spec.finger_holes[0][:2], abs=1e-6)

    def test_side_flip_moves_the_hole(self, printer):
        base = _spec(WIDE_OUTLINE)
        flipped = _spec(WIDE_OUTLINE, finger_hole_side_flip=True)

        bx, by, _ = base.finger_holes[0]
        fx, fy, _ = flipped.finger_holes[0]
        assert math.isclose(bx, fx, abs_tol=0.5)
        assert not math.isclose(by, fy, abs_tol=0.5)

    def test_offset_moves_the_hole_along_its_side_and_stays_on_the_boundary(self, printer):
        base = _spec(WIDE_OUTLINE)
        plus = _spec(WIDE_OUTLINE, finger_hole_offset_mm=5.0)
        minus = _spec(WIDE_OUTLINE, finger_hole_offset_mm=-5.0)

        bx, by, _ = base.finger_holes[0]
        px, py, _ = plus.finger_holes[0]
        mx, my, _ = minus.finger_holes[0]

        # "top"/"bottom" sides are horizontal edges: offset moves x.
        assert px > bx
        assert mx < bx
        assert math.isclose(py, by, abs_tol=0.5)
        assert math.isclose(my, by, abs_tol=0.5)

        pocket_shape = contour_mod.to_shapely(plus.pocket_poly)
        assert pocket_shape.exterior.distance(Point(px, py)) < 0.1

    def test_flip_and_offset_compose(self, printer):
        base = _spec(WIDE_OUTLINE)
        both = _spec(WIDE_OUTLINE, finger_hole_side_flip=True, finger_hole_offset_mm=5.0)
        flipped_only = _spec(WIDE_OUTLINE, finger_hole_side_flip=True)

        bx, _, _ = base.finger_holes[0]
        cx, _, _ = both.finger_holes[0]
        _, fy, _ = flipped_only.finger_holes[0]
        _, cy, _ = both.finger_holes[0]
        assert cx > bx
        assert math.isclose(cy, fy, abs_tol=0.5)

    def test_center_fallback_makes_flip_and_offset_no_ops(self, printer):
        base = _spec(L_BRACKET_OUTLINE)
        overridden = _spec(
            L_BRACKET_OUTLINE, finger_hole_side_flip=True, finger_hole_offset_mm=5.0
        )

        assert base.finger_holes == overridden.finger_holes

    def test_non_finite_offset_is_rejected(self, printer):
        tool = derive_mod.ToolGeometry(outline=WIDE_OUTLINE, silhouette_height_mm=5.0)
        settings = derive_mod.BinSettings(finger_hole=True, finger_hole_offset_mm=float("nan"))

        with pytest.raises(ValueError):
            derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())
