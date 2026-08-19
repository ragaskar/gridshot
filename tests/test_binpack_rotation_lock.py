"""Per-tool rotation lock for `binpack.pack()`'s auto-pack search: `rotations`
may still be one tuple shared by every tool (legacy), or a list with one
rotation-tuple per input poly — a 1-element tuple locks that tool to a single
rotation instead of searching the full set."""

from __future__ import annotations

import pytest

from gridshot.core import binpack as binpack_mod
from gridshot.core.models import Poly


def _rect(w: float, h: float) -> Poly:
    return Poly(exterior=[(0, 0), (w, 0), (w, h), (0, h)])


class TestRotationLock:
    def test_legacy_single_tuple_still_broadcasts_to_every_tool(self):
        polys = [_rect(20, 8), _rect(15, 6), _rect(10, 10)]

        out = binpack_mod.pack(polys, rotations=(0.0, 90.0))

        assert all(entry["rot"] in (0.0, 90.0) for entry in out)

    def test_locked_tool_only_considers_its_one_rotation(self):
        polys = [_rect(20, 8), _rect(15, 6)]

        out = binpack_mod.pack(
            polys, rotations=[(37.0,), (0.0, 90.0, 180.0, 270.0)]
        )

        assert out[0]["rot"] == 37.0
        assert out[1]["rot"] in (0.0, 90.0, 180.0, 270.0)

    def test_locked_tool_still_finds_a_non_colliding_position(self):
        polys = [_rect(20, 8), _rect(20, 8)]
        wall = 2.0

        out = binpack_mod.pack(polys, wall=wall, rotations=[(45.0,), (45.0,)])

        placed = [
            binpack_mod.place_stamp(polys[i], entry["tx"], entry["ty"], entry["rot"])
            for i, entry in enumerate(out)
        ]
        from gridshot.core.contour import to_shapely
        shapes = [to_shapely(p) for p in placed]
        assert shapes[0].distance(shapes[1]) >= wall - 1e-6

    def test_mismatched_rotations_list_length_raises(self):
        polys = [_rect(20, 8), _rect(15, 6)]

        with pytest.raises(ValueError):
            binpack_mod.pack(polys, rotations=[(0.0,)])
