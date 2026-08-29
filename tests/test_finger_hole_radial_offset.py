"""`BinSettings.finger_hole_radial_offset_mm` moves a finger hole along the
*local outward normal* of the pocket outline at its arc-length point:
negative pulls it toward the tool's own interior ("in"), positive pushes it
away from the outline into the surrounding wall ("out"). Distinct from the
legacy `finger_hole_offset_mm` (a bbox-axis nudge in the retired side-anchor
model) — see the field's own docstring in derive.py. Exercises
`derive_bin_spec` directly against hand-built outlines, same style as
test_finger_hole_position.py.

Note on the geometry under test: `derive_bin_spec` places finger holes on the
*clearance-buffered, aligned* pocket outline, not the raw tool outline passed
in — buffering rounds corners into many short segments and can shift which
edge falls at a given arc-length, so a raw outline's own edge directions
("bottom edge is -y") don't carry over to which direction arc 0 actually
points. The direction tests below therefore derive the expected normal from
`_point_and_outward_normal_at_arc_length` applied to the *actual resolved*
ring, the same way test_finger_hole_position.py's
`TestFingerHoleArcMatchesShippedRing` reconstructs points from
`_point_at_arc_length` — an axis-independent check of magnitude/sign/
per-point locality, backed by `TestPointAndOutwardNormalAtArcLength` below,
which unit-tests the normal formula itself against a hand-built ring with
no buffering involved."""

from __future__ import annotations

import math

import pytest
from shapely.geometry import Point

from gridshot.core import bench as bench_mod
from gridshot.core import contour as contour_mod
from gridshot.core import derive as derive_mod
from gridshot.core.models import Poly

WIDE_OUTLINE = Poly(exterior=[(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)])


@pytest.fixture
def printer():
    return bench_mod.default_profile()


def _spec(outline: Poly, **settings_kwargs) -> derive_mod.DerivedBinSpec:
    tool = derive_mod.ToolGeometry(outline=outline, silhouette_height_mm=5.0)
    settings = derive_mod.BinSettings(finger_hole=True, **settings_kwargs)
    return derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())


def _relative_to_ring_start(spec: derive_mod.DerivedBinSpec, point: tuple[float, float]) -> tuple[float, float]:
    """`point` relative to `spec.pocket_poly`'s own first exterior vertex —
    cancels the bbox-recentring `derive_bin_spec` applies to the whole cut
    envelope (which shifts by a different amount per spec once a hole moves
    off-centre), isolating the offset's own effect on position."""
    ring0 = spec.pocket_poly.exterior[0]
    return (point[0] - ring0[0], point[1] - ring0[1])


def _expected_normal(spec: derive_mod.DerivedBinSpec, arc_mm: float) -> tuple[float, float]:
    """The outward normal `derive_bin_spec` itself would compute for `arc_mm`
    against `spec`'s actual resolved pocket ring (see module docstring)."""
    ring = derive_mod._ring_points(contour_mod.to_shapely(spec.pocket_poly))
    _, normal = derive_mod._point_and_outward_normal_at_arc_length(ring, arc_mm)
    return normal


class TestPointAndOutwardNormalAtArcLength:
    """Unit tests of the normal formula itself against a hand-built,
    unbuffered rectangle ring — independent of derive_bin_spec's clearance
    buffering/alignment pipeline, so these pin the actual (dy,-dx) formula
    and its CCW-outward convention directly."""

    RING = [(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)]  # CCW

    def test_bottom_edge_normal_points_straight_down(self):
        point, normal = derive_mod._point_and_outward_normal_at_arc_length(self.RING, 0.0)
        assert point == pytest.approx((-19.0, -5.0))
        assert normal == pytest.approx((0.0, -1.0))

    def test_right_edge_normal_points_straight_right(self):
        # arc 43 = 5mm into the 10mm-tall right edge (bottom edge's 38mm
        # plus its own midpoint) — strictly inside the segment, avoiding the
        # vertex-boundary ambiguity an exact edge-length arc would hit (an
        # arc landing exactly on a shared vertex resolves to the *preceding*
        # segment's tangent, by design — same fencepost `_point_at_arc_length`
        # always had).
        point, normal = derive_mod._point_and_outward_normal_at_arc_length(self.RING, 43.0)
        assert point == pytest.approx((19.0, 0.0))
        assert normal == pytest.approx((1.0, 0.0))

    def test_top_edge_normal_points_straight_up(self):
        point, normal = derive_mod._point_and_outward_normal_at_arc_length(self.RING, 67.0)
        assert point == pytest.approx((0.0, 5.0))
        assert normal == pytest.approx((0.0, 1.0))

    def test_left_edge_normal_points_straight_left(self):
        point, normal = derive_mod._point_and_outward_normal_at_arc_length(self.RING, 91.0)
        assert point == pytest.approx((-19.0, 0.0))
        assert normal == pytest.approx((-1.0, 0.0))

    def test_point_at_arc_length_still_matches_the_combined_helper(self):
        # _point_at_arc_length now delegates to this helper — pin that the
        # refactor didn't change its own return value.
        for arc in (0.0, 10.0, 40.0, 70.0):
            assert derive_mod._point_at_arc_length(self.RING, arc) == pytest.approx(
                derive_mod._point_and_outward_normal_at_arc_length(self.RING, arc)[0]
            )


class TestFingerHoleRadialOffset:
    def test_zero_offset_is_a_no_op(self, printer):
        base = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        explicit_zero = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_radial_offset_mm=0.0)
        assert base.finger_holes == explicit_zero.finger_holes

    def test_offset_moves_the_hole_by_exactly_the_offset_along_the_resolved_normal(self, printer):
        base = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        out = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_radial_offset_mm=3.0)

        bx, by = _relative_to_ring_start(base, base.finger_holes[0][:2])
        ox, oy = _relative_to_ring_start(out, out.finger_holes[0][:2])
        nx, ny = _expected_normal(base, base.finger_hole_arc_mm)
        assert (ox - bx, oy - by) == pytest.approx((nx * 3.0, ny * 3.0), abs=1e-4)

    def test_negative_offset_moves_the_hole_the_opposite_way(self, printer):
        base = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        inn = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_radial_offset_mm=-3.0)

        bx, by = _relative_to_ring_start(base, base.finger_holes[0][:2])
        ix, iy = _relative_to_ring_start(inn, inn.finger_holes[0][:2])
        nx, ny = _expected_normal(base, base.finger_hole_arc_mm)
        assert (ix - bx, iy - by) == pytest.approx((-nx * 3.0, -ny * 3.0), abs=1e-4)

    def test_offset_direction_differs_by_arc_position_not_a_fixed_axis(self, printer):
        # Two different arc positions on the same tool must not happen to
        # move along the same world-space direction — otherwise a regression
        # to "always offset along y" (or any single fixed axis) would slip
        # through the single-arc test above undetected.
        a = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        b = _spec(WIDE_OUTLINE, finger_hole_arc_mm=48.0)
        na = _expected_normal(a, a.finger_hole_arc_mm)
        nb = _expected_normal(b, b.finger_hole_arc_mm)
        assert na != pytest.approx(nb, abs=0.2)

    def test_offset_applies_to_the_legacy_fallback_point_too(self, printer):
        base = _spec(WIDE_OUTLINE)  # finger_hole_arc_mm left unset
        offset = _spec(WIDE_OUTLINE, finger_hole_radial_offset_mm=3.0)

        bx, by = _relative_to_ring_start(base, base.finger_holes[0][:2])
        ox, oy = _relative_to_ring_start(offset, offset.finger_holes[0][:2])
        assert (ox, oy) != pytest.approx((bx, by))
        # Still 3mm away along whatever normal the legacy point's own edge has.
        assert math.hypot(ox - bx, oy - by) == pytest.approx(3.0, abs=1e-4)

    def test_small_offset_stays_off_the_boundary_by_the_offset_distance(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_radial_offset_mm=2.0)
        x, y, _ = spec.finger_holes[0]
        pocket_shape = contour_mod.to_shapely(spec.pocket_poly)
        assert pocket_shape.exterior.distance(Point(x, y)) == pytest.approx(2.0, abs=0.05)

    def test_offset_applies_identically_to_both_span_lobes_along_their_own_normals(self, printer):
        base = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True, finger_hole_arc2_mm=48.0)
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True,
            finger_hole_arc2_mm=48.0, finger_hole_radial_offset_mm=3.0,
        )
        (x1, y1, _), (x2, y2, _) = spec.finger_holes
        (bx1, by1, _), (bx2, by2, _) = base.finger_holes
        rx1, ry1 = _relative_to_ring_start(spec, (x1, y1))
        rbx1, rby1 = _relative_to_ring_start(base, (bx1, by1))
        rx2, ry2 = _relative_to_ring_start(spec, (x2, y2))
        rbx2, rby2 = _relative_to_ring_start(base, (bx2, by2))

        n1 = _expected_normal(base, base.finger_hole_arc_mm)
        n2 = _expected_normal(base, base.finger_hole_arc2_mm)
        assert (rx1 - rbx1, ry1 - rby1) == pytest.approx((n1[0] * 3.0, n1[1] * 3.0), abs=1e-4)
        assert (rx2 - rbx2, ry2 - rby2) == pytest.approx((n2[0] * 3.0, n2[1] * 3.0), abs=1e-4)
        # The two lobes are on different edges — confirms this test actually
        # discriminates per-point direction rather than a shared constant.
        assert n1 != pytest.approx(n2, abs=0.2)

    def test_large_positive_offset_pushes_the_hole_fully_outside_the_pocket_without_crashing(self, printer):
        # 10mm offset, 10mm-diameter hole (radius 5): the hole's near edge
        # sits 5mm clear of the pocket boundary — genuinely disjoint, which
        # used to make `sizing` a MultiPolygon and crash contour_mod.
        # from_shapely. Exercises the convex-hull fallback.
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0,
            finger_hole_diameter_mm=10.0, finger_hole_radial_offset_mm=10.0,
        )
        x, y, d = spec.finger_holes[0]
        pocket_shape = contour_mod.to_shapely(spec.pocket_poly)
        hole = Point(x, y).buffer(d / 2)
        assert not pocket_shape.intersects(hole)
        # The sizing envelope (grid/footprint sizing) still fully encloses
        # both the pocket and the now-disjoint hole.
        sizing_shape = contour_mod.to_shapely(spec.sizing_poly)
        assert sizing_shape.covers(pocket_shape.buffer(-0.05))
        assert sizing_shape.covers(hole.buffer(-0.05))

    def test_moderate_negative_offset_pulls_the_hole_fully_inside_the_pocket_without_crashing(self, printer):
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0,
            finger_hole_diameter_mm=2.0, finger_hole_radial_offset_mm=-2.0,
        )
        x, y, d = spec.finger_holes[0]
        pocket_shape = contour_mod.to_shapely(spec.pocket_poly)
        hole = Point(x, y).buffer(d / 2)
        assert pocket_shape.covers(hole.buffer(-0.05))

    def test_derivation_key_changes_with_the_offset(self, printer):
        a = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_radial_offset_mm=0.0)
        b = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_radial_offset_mm=3.0)
        assert a.derivation_key != b.derivation_key

    def test_non_finite_offset_is_rejected(self, printer):
        tool = derive_mod.ToolGeometry(outline=WIDE_OUTLINE, silhouette_height_mm=5.0)
        settings = derive_mod.BinSettings(finger_hole=True, finger_hole_radial_offset_mm=float("nan"))

        with pytest.raises(ValueError):
            derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())
