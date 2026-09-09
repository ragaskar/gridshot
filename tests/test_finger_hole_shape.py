"""The finger hole's cross-section shape: "circular" (historical, diameter-
only) or "rounded_rect" (length/width/corner-radius, oriented so its length
edge runs along the pocket outline's own tangent at that arc position — see
derive.derive_bin_spec's `_finger_hole_shape_polygon`). Exercises
`derive_bin_spec` directly against a hand-built outline, same style as
test_finger_hole_position.py."""

from __future__ import annotations

import math

import pytest
from shapely.geometry import Point

from gridshot.core import bench as bench_mod
from gridshot.core import contour as contour_mod
from gridshot.core import derive as derive_mod
from gridshot.core.models import Poly

# Perimeter 2*(38+10)=96mm; exterior starts at (-19,-5) going CCW — same
# fixture as test_finger_hole_position.py. Arc 0 sits on the bottom edge
# (world y=-5), whose tangent runs along world +x.
WIDE_OUTLINE = Poly(exterior=[(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)])


@pytest.fixture
def printer():
    return bench_mod.default_profile()


def _spec(outline: Poly, **settings_kwargs) -> derive_mod.DerivedBinSpec:
    tool = derive_mod.ToolGeometry(outline=outline, silhouette_height_mm=5.0)
    settings = derive_mod.BinSettings(finger_hole=True, **settings_kwargs)
    return derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())


class TestCircularIsUnaffected:
    def test_default_shape_produces_no_shape_polys(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_diameter_mm=12.0)
        assert spec.finger_hole_shape_polys == []
        assert spec.finger_holes[0][2] == 12.0

    def test_explicit_circular_shape_is_the_same_as_the_default(self, printer):
        a = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_diameter_mm=12.0)
        b = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_diameter_mm=12.0,
            finger_hole_shape="circular",
        )
        assert a.finger_holes == b.finger_holes
        assert b.finger_hole_shape_polys == []


class TestRoundedRect:
    def test_one_shape_poly_per_focal_point(self, printer):
        single = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
            finger_hole_length_mm=16.0, finger_hole_width_mm=10.0, finger_hole_corner_radius_mm=2.0,
        )
        assert len(single.finger_holes) == 1
        assert len(single.finger_hole_shape_polys) == 1

        span = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True, finger_hole_arc2_mm=10.0,
            finger_hole_shape="rounded_rect",
            finger_hole_length_mm=16.0, finger_hole_width_mm=10.0, finger_hole_corner_radius_mm=2.0,
        )
        assert len(span.finger_holes) == 2
        assert len(span.finger_hole_shape_polys) == 2

    def test_fallback_diameter_is_the_circumscribing_hypot_not_the_max_side(self, printer):
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
            finger_hole_length_mm=16.0, finger_hole_width_mm=10.0, finger_hole_corner_radius_mm=2.0,
        )
        assert spec.finger_holes[0][2] == pytest.approx(math.hypot(16.0, 10.0))

    def test_area_matches_a_rounded_rect_of_the_requested_dimensions(self, printer):
        length, width, radius = 16.0, 10.0, 2.0
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
            finger_hole_length_mm=length, finger_hole_width_mm=width, finger_hole_corner_radius_mm=radius,
        )
        poly = contour_mod.to_shapely(spec.finger_hole_shape_polys[0])
        # Rounded-rect area: full rect minus the 4 corner squares plus the 4
        # quarter-circles = L*W - 4*r^2 + pi*r^2.
        expected_area = length * width - (4 - math.pi) * radius * radius
        assert poly.area == pytest.approx(expected_area, rel=1e-3)

    def test_oriented_along_the_bottom_edge_tangent_length_along_world_x(self, printer):
        # Arc 0 is the ring's start vertex, on the bottom edge (world y=-5),
        # whose tangent runs along world +x — so the rect's *length* (16mm,
        # the longer side) should span the ring's own tangent direction at
        # arc 0, and its *width* (10mm) the perpendicular (normal) direction
        # — whichever world axis that tangent actually turns out to be
        # (`_align_for_bin` may reorient the outline before this point, so
        # arc 0 isn't necessarily still on the same edge WIDE_OUTLINE's own
        # input coordinates suggest — see test_finger_hole_position.py's own
        # tests, which derive expectations from `spec.pocket_poly`'s ring
        # for the same reason rather than the raw input outline).
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
            finger_hole_length_mm=16.0, finger_hole_width_mm=10.0, finger_hole_corner_radius_mm=2.0,
        )
        ring = derive_mod._ring_points(contour_mod.to_shapely(spec.pocket_poly))
        _, (nx, ny) = derive_mod._point_and_outward_normal_at_arc_length(ring, 0.0)
        tangent = (-ny, nx)
        fx, fy, _ = spec.finger_holes[0]
        poly = contour_mod.to_shapely(spec.finger_hole_shape_polys[0])
        # Project every corner onto the tangent/normal axes, centred on the
        # focal point — the extents along each should match length/width.
        along = [
            (px - fx) * tangent[0] + (py - fy) * tangent[1] for px, py in poly.exterior.coords
        ]
        across = [
            (px - fx) * nx + (py - fy) * ny for px, py in poly.exterior.coords
        ]
        assert (max(along) - min(along)) == pytest.approx(16.0, abs=0.05)
        assert (max(across) - min(across)) == pytest.approx(10.0, abs=0.05)

    def test_centered_on_the_focal_point(self, printer):
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
            finger_hole_length_mm=16.0, finger_hole_width_mm=10.0, finger_hole_corner_radius_mm=2.0,
        )
        fx, fy, _ = spec.finger_holes[0]
        poly = contour_mod.to_shapely(spec.finger_hole_shape_polys[0])
        minx, miny, maxx, maxy = poly.bounds
        assert (minx + maxx) / 2 == pytest.approx(fx, abs=1e-6)
        assert (miny + maxy) / 2 == pytest.approx(fy, abs=1e-6)

    def test_unset_dimensions_fall_back_to_the_module_defaults(self, printer):
        spec = _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect")
        ring = derive_mod._ring_points(contour_mod.to_shapely(spec.pocket_poly))
        _, (nx, ny) = derive_mod._point_and_outward_normal_at_arc_length(ring, 0.0)
        tangent = (-ny, nx)
        fx, fy, _ = spec.finger_holes[0]
        poly = contour_mod.to_shapely(spec.finger_hole_shape_polys[0])
        along = [(px - fx) * tangent[0] + (py - fy) * tangent[1] for px, py in poly.exterior.coords]
        across = [(px - fx) * nx + (py - fy) * ny for px, py in poly.exterior.coords]
        assert (max(along) - min(along)) == pytest.approx(derive_mod.DEFAULT_FINGER_HOLE_LENGTH_MM, abs=0.05)
        assert (max(across) - min(across)) == pytest.approx(derive_mod.DEFAULT_FINGER_HOLE_WIDTH_MM, abs=0.05)

    def test_sizing_poly_encloses_the_rect_not_just_a_circle_of_the_fallback_diameter(self, printer):
        # A rect longer than it is wide should widen the packed footprint
        # along its length axis by more than a circle of the fallback
        # (hypot) diameter would — proving sizing consults the real shape,
        # not the fallback circle.
        # A finger hole this long relative to the (10mm-tall) outline can
        # only fit in `sizing` at all if the real rect shape — not a circle
        # of the fallback hypot(length, width) diameter — was unioned in
        # along its own tangent axis: a circle would need centre clearance
        # of radius ~15.6mm on *every* side, badly overshooting the pocket's
        # own short axis and changing the packed footprint's *other* extent
        # too. Assert directly on the tangent-axis projection instead of
        # world x/y — see the orientation test above for why.
        length, width = 30.0, 6.0
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
            finger_hole_length_mm=length, finger_hole_width_mm=width, finger_hole_corner_radius_mm=1.0,
        )
        ring = derive_mod._ring_points(contour_mod.to_shapely(spec.pocket_poly))
        _, (nx, ny) = derive_mod._point_and_outward_normal_at_arc_length(ring, 0.0)
        tangent = (-ny, nx)
        fx, fy, _ = spec.finger_holes[0]
        sizing = contour_mod.to_shapely(spec.sizing_poly)
        along = [(px - fx) * tangent[0] + (py - fy) * tangent[1] for px, py in sizing.exterior.coords]
        assert (max(along) - min(along)) >= length - 0.5

    def test_span_connector_uses_width_not_the_circumscribing_diameter(self, printer):
        spec = _spec(
            WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_span=True, finger_hole_arc2_mm=10.0,
            finger_hole_shape="rounded_rect",
            finger_hole_length_mm=16.0, finger_hole_width_mm=6.0, finger_hole_corner_radius_mm=1.0,
        )
        # finger_hole_span_poly is a stadium buffered by connector_radius —
        # its cross-axis extent (perpendicular to the line between the two
        # points, both on the same edge here) should match width_mm, not
        # the much larger hypot(length, width) fallback. Project onto the
        # normal axis at P1 rather than assuming world x/y.
        ring = derive_mod._ring_points(contour_mod.to_shapely(spec.pocket_poly))
        _, (nx, ny) = derive_mod._point_and_outward_normal_at_arc_length(ring, 0.0)
        fx, fy, _ = spec.finger_holes[0]
        connector = contour_mod.to_shapely(spec.finger_hole_span_poly)
        across = [(px - fx) * nx + (py - fy) * ny for px, py in connector.exterior.coords]
        assert (max(across) - min(across)) == pytest.approx(6.0, abs=0.05)


class TestValidation:
    def test_rejects_an_unknown_shape(self, printer):
        with pytest.raises(ValueError, match="shape"):
            _spec(WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="triangular")

    def test_rejects_a_non_positive_length(self, printer):
        with pytest.raises(ValueError, match="length"):
            _spec(
                WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
                finger_hole_length_mm=0.0,
            )

    def test_rejects_a_negative_corner_radius(self, printer):
        with pytest.raises(ValueError, match="corner radius"):
            _spec(
                WIDE_OUTLINE, finger_hole_arc_mm=0.0, finger_hole_shape="rounded_rect",
                finger_hole_corner_radius_mm=-1.0,
            )


class TestFrontendBackendLockstep:
    """Pins the exact same numeric bounding boxes web/src/geometry/
    perimeter.test.ts's own `fingerHoleRectPoints` describe block asserts,
    against `_finger_hole_shape_polygon` directly (bypassing
    `derive_bin_spec`'s outline alignment, which would reorient the ring —
    see test_finger_hole_shape.py's own orientation tests above for why that
    matters) so both implementations are checked against the same
    independently hand-derived numbers rather than against each other."""

    # A 20x10 rect, perimeter 60: bottom edge arc [0,20) at y=-5, right
    # [20,30), top [30,50), left [50,60) — literally the same ring as the
    # TS test's WIDE_RECT.
    RING = [(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]

    def test_on_the_bottom_edge(self):
        point, normal = derive_mod._point_and_outward_normal_at_arc_length(self.RING, 10.0)
        poly = derive_mod._finger_hole_shape_polygon(Point(point), normal, 16.0, 10.0, 2.0)
        minx, miny, maxx, maxy = poly.bounds
        assert (minx, miny, maxx, maxy) == pytest.approx((-8.0, -10.0, 8.0, 0.0), abs=1e-6)

    def test_on_the_right_edge_a_genuine_90_degree_rotation(self):
        point, normal = derive_mod._point_and_outward_normal_at_arc_length(self.RING, 25.0)
        poly = derive_mod._finger_hole_shape_polygon(Point(point), normal, 16.0, 10.0, 2.0)
        minx, miny, maxx, maxy = poly.bounds
        assert (minx, miny, maxx, maxy) == pytest.approx((5.0, -8.0, 15.0, 8.0), abs=1e-6)
