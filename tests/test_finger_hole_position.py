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


class TestFingerHoleArcMatchesShippedRing:
    """`spec.finger_holes[0]` (the actual x/y a client renders) and
    `spec.finger_hole_arc_mm` (the number a client echoes back as an
    override next request) must describe the *same* point when the
    arc-length is re-walked against `spec.pocket_poly` — the exact ring a
    client receives as a tool's "stamp" and re-parametrizes its own
    drag/nudge/align math against.

    Regression: `derive_bin_spec` used to compute `finger_hole_arc_mm`
    against its own internal, not-yet-oriented `pocket_shape`, while
    `contour_mod.from_shapely` (used both for `pocket_poly` here and for
    every "stamp" ever sent to a client) forces the exterior ring
    counter-clockwise. When the internal ring came out clockwise — which it
    does for a plain rectangle once the capture's y-down-to-y-up flip
    reverses its handedness — the two rings walked in opposite directions
    from the same starting vertex, so the *same* arc-length number resolved
    to two different points depending which ring read it: correct in the
    client's own local re-derivation (2D drag/align), wrong wherever the
    server re-derives a point from a stored arc-length (3D render, and
    anything reloaded from a saved bin). `test_arc_mm_zero_...` above can't
    catch this: arc 0 always lands on the shared starting vertex regardless
    of which direction the ring is walked, which is exactly why this needs
    a nonzero arc to discriminate."""

    def test_reported_arc_length_reproduces_the_reported_point(self, printer):
        for arc in (10.0, 25.0, 40.0):
            spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=arc)
            recon = derive_mod._point_at_arc_length(
                list(spec.pocket_poly.exterior), spec.finger_hole_arc_mm
            )
            assert recon == pytest.approx(spec.finger_holes[0][:2], abs=1e-6)

    def test_holds_for_the_legacy_fallback_arc_length_too(self, printer):
        spec = _spec(WIDE_OUTLINE)  # finger_hole_arc_mm left unset
        recon = derive_mod._point_at_arc_length(
            list(spec.pocket_poly.exterior), spec.finger_hole_arc_mm
        )
        assert recon == pytest.approx(spec.finger_holes[0][:2], abs=1e-6)

    def test_holds_for_the_span_hole_second_point(self, printer):
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=5.0, finger_hole_span=True,
            finger_hole_arc2_mm=30.0,
        )
        ring = list(spec.pocket_poly.exterior)
        recon1 = derive_mod._point_at_arc_length(ring, spec.finger_hole_arc_mm)
        recon2 = derive_mod._point_at_arc_length(ring, spec.finger_hole_arc2_mm)
        assert recon1 == pytest.approx(spec.finger_holes[0][:2], abs=1e-6)
        assert recon2 == pytest.approx(spec.finger_holes[1][:2], abs=1e-6)


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


class TestFingerHoleDiameter:
    """`BinSettings.finger_hole_diameter_mm` scales the hole's cut diameter.
    `None` (default) keeps today's fixed 20mm. The center never moves when
    the diameter changes — only the reported diameter and the sizing
    envelope that must fully contain the enlarged/shrunk circle."""

    def test_default_diameter_is_20mm(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        assert spec.finger_holes[0][2] == pytest.approx(20.0)

    def test_diameter_override_changes_size_but_not_arc_position(self, printer):
        # The overall cut envelope re-centers on origin as its bounding box
        # grows with a bigger hole (existing behavior, unrelated to this
        # feature), so raw x/y shift — the invariant that must hold is that
        # the hole stays at the same *arc-length* position along the
        # boundary, still touching it, regardless of diameter.
        base = _spec(WIDE_OUTLINE, finger_hole_arc_mm=10.0)
        bigger = _spec(WIDE_OUTLINE, finger_hole_arc_mm=10.0, finger_hole_diameter_mm=40.0)

        bx, by, bd = base.finger_holes[0]
        gx, gy, gd = bigger.finger_holes[0]
        assert bd == pytest.approx(20.0)
        assert gd == pytest.approx(40.0)
        assert base.finger_hole_arc_mm == pytest.approx(bigger.finger_hole_arc_mm)

        base_pocket = contour_mod.to_shapely(base.pocket_poly)
        bigger_pocket = contour_mod.to_shapely(bigger.pocket_poly)
        assert base_pocket.exterior.distance(Point(bx, by)) < 0.1
        assert bigger_pocket.exterior.distance(Point(gx, gy)) < 0.1

    def test_diameter_override_keeps_the_full_circle_inside_the_sizing_envelope(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_diameter_mm=40.0)
        x, y, d = spec.finger_holes[0]
        sizing_shape = contour_mod.to_shapely(spec.sizing_poly)
        assert sizing_shape.covers(Point(x, y).buffer(d / 2).buffer(-0.05))

    def test_non_finite_diameter_is_rejected(self, printer):
        tool = derive_mod.ToolGeometry(outline=WIDE_OUTLINE, silhouette_height_mm=5.0)
        settings = derive_mod.BinSettings(finger_hole=True, finger_hole_diameter_mm=float("nan"))

        with pytest.raises(ValueError):
            derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())

    def test_non_positive_diameter_is_rejected(self, printer):
        tool = derive_mod.ToolGeometry(outline=WIDE_OUTLINE, silhouette_height_mm=5.0)
        settings = derive_mod.BinSettings(finger_hole=True, finger_hole_diameter_mm=0.0)

        with pytest.raises(ValueError):
            derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())


# A "dogbone": wide at both ends (x in [-30,-10] and [10,30], y in [-10,10]),
# narrow through the middle (x in [-10,10], y in [-3,3]) — a synthetic stand-in
# for a wrench/pliers whose waist is much narrower than a 20mm finger hole.
DOGBONE_OUTLINE = Poly(exterior=[
    (-30.0, -10.0), (-10.0, -10.0), (-10.0, -3.0), (10.0, -3.0),
    (10.0, -10.0), (30.0, -10.0), (30.0, 10.0), (10.0, 10.0),
    (10.0, 3.0), (-10.0, 3.0), (-10.0, 10.0), (-30.0, 10.0),
])


class TestFingerHoleSpan:
    """`BinSettings.finger_hole_span` turns the single circular hole into a
    two-lobe stadium/pill: a second focal point (`finger_hole_arc2_mm`) plus
    the exact capsule polygon connecting them, so the cut spans clean across
    a tool even where the plain pocket between the two points is much
    narrower than the hole diameter (the two-circles-only shortcut would
    silently under-cut exactly this case)."""

    def test_span_off_by_default_reports_a_single_point(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        assert len(spec.finger_holes) == 1
        assert spec.finger_hole_span_poly is None

    def test_span_on_reports_two_points_sharing_one_diameter(self, printer):
        base = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True,
            finger_hole_arc2_mm=30.0, finger_hole_diameter_mm=14.0,
        )
        assert len(spec.finger_holes) == 2
        (x1, y1, d1), (x2, y2, d2) = spec.finger_holes
        assert d1 == pytest.approx(14.0)
        assert d2 == pytest.approx(14.0)
        assert (x1, y1) != pytest.approx((x2, y2))
        # P1's arc-length position is unaffected by span turning on — same
        # boundary spot base's single hole used (raw x/y shift because the
        # overall cut envelope re-centers on origin as its bbox grows to fit
        # the span, same as the diameter test above).
        assert spec.finger_hole_arc_mm == pytest.approx(base.finger_hole_arc_mm)

    def test_missing_arc2_falls_back_to_the_far_side_of_the_ring(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True)
        assert len(spec.finger_holes) == 2
        ring = derive_mod._ring_points(contour_mod.to_shapely(spec.pocket_poly))
        total_len = derive_mod._ring_length(ring)
        assert spec.finger_hole_arc2_mm == pytest.approx(total_len / 2, abs=1e-6)

    def test_span_channel_covers_the_midpoint_between_far_apart_points(self, printer):
        span = _spec(
            DOGBONE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True,
            finger_hole_diameter_mm=20.0,
        )
        (x1, y1, d1), (x2, y2, _) = span.finger_holes
        dist = math.hypot(x2 - x1, y2 - y1)
        # Confirms this is actually a discriminating case: the two lobes are
        # far enough apart that circles alone wouldn't overlap or touch.
        assert dist > d1

        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        sizing_shape = contour_mod.to_shapely(span.sizing_poly)
        assert sizing_shape.covers(Point(mx, my).buffer(0.05))

    def test_span_poly_is_a_capsule_between_the_two_points(self, printer):
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True,
            finger_hole_arc2_mm=30.0, finger_hole_diameter_mm=14.0,
        )
        (x1, y1, _), (x2, y2, _) = spec.finger_holes
        span_shape = contour_mod.to_shapely(spec.finger_hole_span_poly)
        expected_area = math.pi * (14.0 / 2) ** 2 + 14.0 * math.hypot(x2 - x1, y2 - y1)
        assert span_shape.area == pytest.approx(expected_area, rel=0.02)

    def test_span_off_after_on_drops_the_second_point(self, printer):
        base = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0)
        spanned_then_off = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=False,
            finger_hole_arc2_mm=30.0,
        )
        assert len(spanned_then_off.finger_holes) == 1
        assert spanned_then_off.finger_holes[0][:2] == pytest.approx(base.finger_holes[0][:2], abs=1e-6)

    def test_non_finite_arc2_is_rejected(self, printer):
        tool = derive_mod.ToolGeometry(outline=WIDE_OUTLINE, silhouette_height_mm=5.0)
        settings = derive_mod.BinSettings(
            finger_hole=True, finger_hole_span=True, finger_hole_arc2_mm=float("nan"),
        )

        with pytest.raises(ValueError):
            derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())
