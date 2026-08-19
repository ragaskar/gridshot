"""Bounded auto-pack for `binpack.pack()`: optional `max_w`/`max_h` constrain
the search to a fixed footprint instead of letting it grow unboundedly, and
raise `PackingOverflowError` when a tool can't fit at any allowed rotation
or position within that bound."""

from __future__ import annotations

import pytest

from gridshot.core import binpack as binpack_mod
from gridshot.core.models import Poly


def _rect(w: float, h: float) -> Poly:
    return Poly(exterior=[(0, 0), (w, 0), (w, h), (0, h)])


class TestBoundedPack:
    def test_unbounded_call_is_unaffected(self):
        polys = [_rect(20, 8), _rect(15, 6), _rect(10, 10)]

        out = binpack_mod.pack(polys)

        assert len(out) == 3
        assert all(entry is not None for entry in out)

    def test_two_small_tools_fit_a_generous_bound(self):
        polys = [_rect(10, 8), _rect(8, 6)]

        out = binpack_mod.pack(polys, wall=2.0, max_w=100.0, max_h=100.0)

        placed = [
            binpack_mod.place_stamp(polys[i], entry["tx"], entry["ty"], entry["rot"])
            for i, entry in enumerate(out)
        ]
        from gridshot.core.contour import to_shapely
        shapes = [to_shapely(p) for p in placed]
        for shape in shapes:
            minx, miny, maxx, maxy = shape.bounds
            assert maxx - minx <= 100.0
            assert maxy - miny <= 100.0

    def test_a_tool_too_big_for_the_bound_raises_packing_overflow(self):
        polys = [_rect(200, 200)]

        with pytest.raises(binpack_mod.PackingOverflowError):
            binpack_mod.pack(polys, wall=2.0, max_w=50.0, max_h=50.0)

    def test_bound_is_respected_even_when_it_would_fit_unbounded(self):
        polys = [_rect(40, 10), _rect(40, 10)]

        # These two would happily pack side by side in an unbounded search
        # (an 80x10-ish footprint), but not within a deliberately tight bound.
        with pytest.raises(binpack_mod.PackingOverflowError):
            binpack_mod.pack(polys, wall=2.0, max_w=45.0, max_h=10.5)
