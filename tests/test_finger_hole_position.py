"""Fine control over finger-hole placement: `BinSettings.finger_hole_side_flip`
mirrors the default hole to the opposite side of the pocket, and
`finger_hole_offset_mm` slides it along that side, always re-snapped onto the
tool's real boundary. Exercises `derive_bin_spec` directly against hand-built
outlines — no library/route fixtures needed for the geometry math itself."""

from __future__ import annotations

import math

import pytest

from gridshot.core import bench as bench_mod
from gridshot.core import contour as contour_mod
from gridshot.core import derive as derive_mod
from gridshot.core.models import Poly

# A rectangle whose default finger-hole placement lands on a named bbox edge
# ("top" or "bottom"), not the representative-point fallback — wide relative
# to its height, centred on the origin.
WIDE_OUTLINE = Poly(exterior=[(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)])

# An L-bracket whose default finger hole falls back to the interior
# representative-point anchor, far from every bbox edge ("center").
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


_MIRROR = {"bottom": "top", "top": "bottom", "left": "right", "right": "left"}


class TestFingerHolePosition:
    def test_default_lands_on_a_named_side(self, printer):
        spec = _spec(WIDE_OUTLINE)

        assert spec.finger_hole_side in ("top", "bottom", "left", "right")
        assert spec.finger_hole_offset_max_mm > 0

    def test_side_flip_moves_the_hole_to_the_mirrored_side(self, printer):
        base = _spec(WIDE_OUTLINE)
        flipped = _spec(WIDE_OUTLINE, finger_hole_side_flip=True)

        assert flipped.finger_hole_side == _MIRROR[base.finger_hole_side]
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
        from shapely.geometry import Point
        assert pocket_shape.exterior.distance(Point(px, py)) < 0.1

    def test_flip_and_offset_compose_relative_to_the_mirrored_side(self, printer):
        base = _spec(WIDE_OUTLINE)
        both = _spec(WIDE_OUTLINE, finger_hole_side_flip=True, finger_hole_offset_mm=5.0)

        assert both.finger_hole_side == _MIRROR[base.finger_hole_side]
        bx, _, _ = base.finger_holes[0]
        cx, _, _ = both.finger_holes[0]
        assert cx > bx

    def test_center_side_makes_flip_and_offset_no_ops(self, printer):
        base = _spec(L_BRACKET_OUTLINE)
        overridden = _spec(
            L_BRACKET_OUTLINE, finger_hole_side_flip=True, finger_hole_offset_mm=5.0
        )

        assert base.finger_hole_side == "center"
        assert overridden.finger_hole_side == "center"
        assert base.finger_holes == overridden.finger_holes
        assert base.finger_hole_offset_max_mm == 0.0

    def test_non_finite_offset_is_rejected(self, printer):
        tool = derive_mod.ToolGeometry(outline=WIDE_OUTLINE, silhouette_height_mm=5.0)
        settings = derive_mod.BinSettings(finger_hole=True, finger_hole_offset_mm=float("nan"))

        with pytest.raises(ValueError):
            derive_mod.derive_bin_spec(tool, settings, bench_mod.default_profile())
