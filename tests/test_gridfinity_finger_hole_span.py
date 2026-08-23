"""bin_solid finger-hole span connector: `finger_hole_connector` is the exact
stadium/capsule polygon between two far-apart focal points, and must remove
material across the whole channel — not just the two circular lobes already
carried in `finger_holes` — since for a tool wider than the hole diameter at
that cross-section, two isolated circles wouldn't touch or overlap at all."""

from __future__ import annotations

import pytest
from shapely.geometry import LineString

from gridshot.core import gridfinity as grid_mod
from gridshot.core.contour import from_shapely
from gridshot.core.models import Poly


def _wide_pocket() -> Poly:
    return Poly(exterior=[(-40.0, -5.0), (40.0, -5.0), (40.0, 5.0), (-40.0, 5.0)])


P1 = (-35.0, 0.0)
P2 = (35.0, 0.0)
DIAMETER = 20.0


def _connector() -> Poly:
    return from_shapely(LineString([P1, P2]).buffer(DIAMETER / 2, cap_style="round"))


class TestFingerHoleSpanConnectorFastPath:
    def test_connector_removes_more_material_than_two_isolated_lobes(self):
        pocket = _wide_pocket()
        without_connector = grid_mod.bin_solid(
            3, 1, 3, pocket=pocket, pocket_depth=5.0,
            finger_holes=[(*P1, DIAMETER), (*P2, DIAMETER)],
        )
        with_connector = grid_mod.bin_solid(
            3, 1, 3, pocket=pocket, pocket_depth=5.0,
            finger_holes=[(*P1, DIAMETER), (*P2, DIAMETER)],
            finger_hole_connector=_connector(),
        )

        vol_without = grid_mod.to_trimesh(without_connector).volume
        vol_with = grid_mod.to_trimesh(with_connector).volume
        assert vol_with < vol_without

    def test_no_connector_given_is_a_no_op(self):
        pocket = _wide_pocket()
        a = grid_mod.bin_solid(3, 1, 3, pocket=pocket, pocket_depth=5.0)
        b = grid_mod.bin_solid(3, 1, 3, pocket=pocket, pocket_depth=5.0, finger_hole_connector=None)
        assert grid_mod.to_trimesh(a).volume == pytest.approx(grid_mod.to_trimesh(b).volume)


class TestFingerHoleSpanConnectorViaPocketsParam:
    """The multi-tool combine editor calls `bin_solid(pockets=[...])` with
    4-tuples `(pocket, depth, fingers, connector)` instead of the single-
    pocket convenience kwargs — same connector behavior must apply there."""

    def test_connector_as_fourth_pocket_tuple_element_removes_material(self):
        pocket = _wide_pocket()
        pockets_without = [(pocket, 5.0, [(*P1, DIAMETER), (*P2, DIAMETER)])]
        pockets_with = [(pocket, 5.0, [(*P1, DIAMETER), (*P2, DIAMETER)], _connector())]

        without_connector = grid_mod.bin_solid(3, 1, 3, pockets=pockets_without)
        with_connector = grid_mod.bin_solid(3, 1, 3, pockets=pockets_with)

        vol_without = grid_mod.to_trimesh(without_connector).volume
        vol_with = grid_mod.to_trimesh(with_connector).volume
        assert vol_with < vol_without
