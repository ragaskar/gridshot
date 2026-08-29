"""`bevel_pockets` (default on; UI label "Round pocket edges"): rounds off
each pocket's top opening edge — plus its finger holes and their
connector — in bin_solid's fast path with a convex fillet, cutting a little
extra material at the sharp edge where the pocket wall meets the bin's top
surface — see grid_mod.POCKET_ROUND_RADIUS_MM/_pocket_top_round_radius."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from manifold3d import CrossSection, OpType
from shapely.geometry import Point, Polygon, box

from gridshot.core import gridfinity as grid_mod
from gridshot.core import library as library_mod
from gridshot.core.contour import from_shapely
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(exterior=[(-15.0, -15.0), (15.0, -15.0), (15.0, 15.0), (-15.0, 15.0)])
TOOL_B_OUTLINE = Poly(exterior=[(-10.0, -8.0), (10.0, -8.0), (10.0, 8.0), (-10.0, 8.0)])


def _square_pocket(size: float = 20.0) -> Poly:
    half = size / 2
    return Poly(exterior=[(-half, -half), (half, -half), (half, half), (-half, half)])


def _bin_with_pocket(bevel_pockets: bool, depth: float = 10.0, size: float = 20.0, **kwargs):
    return grid_mod.bin_solid(
        2, 1, 3, pocket=_square_pocket(size), pocket_depth=depth,
        bevel_pockets=bevel_pockets, **kwargs,
    )


class TestPocketTopBevel:
    def test_off_by_default_at_the_bin_solid_level(self):
        # bin_solid's own default is conservative (False) — the *request*
        # model (CombineRequest) defaults to True, tested separately below.
        default = grid_mod.to_trimesh(_bin_with_pocket(bevel_pockets=False)).volume
        explicit_off = grid_mod.to_trimesh(grid_mod.bin_solid(
            2, 1, 3, pocket=_square_pocket(), pocket_depth=10.0,
        )).volume
        assert default == pytest.approx(explicit_off)

    def test_bevel_removes_additional_material(self):
        plain = grid_mod.to_trimesh(_bin_with_pocket(bevel_pockets=False)).volume
        beveled = grid_mod.to_trimesh(_bin_with_pocket(bevel_pockets=True)).volume
        assert beveled < plain

    def test_produces_a_watertight_mesh(self):
        mesh = grid_mod.to_trimesh(_bin_with_pocket(bevel_pockets=True))
        assert mesh.is_watertight

    def test_watertight_with_a_lip(self):
        mesh = grid_mod.to_trimesh(_bin_with_pocket(bevel_pockets=True, lip=True))
        assert mesh.is_watertight

    def test_watertight_for_a_round_pocket(self):
        round_pocket = from_shapely(Point(0, 0).buffer(10.0, quad_segs=32))
        solid = grid_mod.bin_solid(
            2, 1, 3, pocket=round_pocket, pocket_depth=10.0, bevel_pockets=True,
        )
        assert grid_mod.to_trimesh(solid).is_watertight

    def test_watertight_for_a_concave_pocket_outline(self):
        l_shape = from_shapely(Polygon(
            [(-10, -10), (5, -10), (5, 0), (10, 0), (10, 10), (-10, 10)]
        ))
        solid = grid_mod.bin_solid(
            2, 1, 3, pocket=l_shape, pocket_depth=10.0, bevel_pockets=True,
        )
        assert grid_mod.to_trimesh(solid).is_watertight

    def test_concave_pocket_outline_does_not_erode_its_own_convex_hull_bay(self):
        # Regression: _pocket_top_fillet used to hull two different-outset
        # plates of the *same* cross-section unconditionally. For a concave
        # outline that bridges the outline's own bays with a flat phantom
        # face and erodes material well outside the pocket — anywhere
        # inside the outline's convex hull but outside the outline itself,
        # like the notch this L-shape carves out of its bottom-right
        # corner. A point in that notch (outside the polygon, inside its
        # hull) must stay solid near the rim, not get carved away.
        l_shape_shapely = Polygon(
            [(-10, -10), (5, -10), (5, 0), (10, 0), (10, 10), (-10, 10)]
        )
        notch_point = Point(7.0, -3.0)
        assert not l_shape_shapely.contains(notch_point)
        assert l_shape_shapely.convex_hull.contains(notch_point)

        l_shape = from_shapely(l_shape_shapely)
        depth = 10.0
        height_u = 3
        total_h = height_u * grid_mod.UNIT_H
        solid = grid_mod.bin_solid(
            2, 1, height_u, pocket=l_shape, pocket_depth=depth, bevel_pockets=True,
        )
        eps = 0.05
        probe = CrossSection([[
            (7.0 - eps, -3.0 - eps), (7.0 + eps, -3.0 - eps),
            (7.0 + eps, -3.0 + eps), (7.0 - eps, -3.0 + eps),
        ]])
        cropped = CrossSection.batch_boolean(
            [solid.slice(total_h - 0.02), probe], OpType.Intersect,
        )
        assert cropped.area() == pytest.approx((2 * eps) ** 2, rel=1e-3)

    def test_watertight_with_two_adjacent_pockets_at_minimum_tool_wall(self):
        p1 = from_shapely(box(-19, -8, -1, 8))
        p2 = from_shapely(box(1, -8, 19, 8))
        pockets = [(p1, 10.0, [], None), (p2, 10.0, [], None)]
        solid = grid_mod.bin_solid(
            3, 1, 3, pockets=pockets, bevel_pockets=True, tool_wall_mm=2.0,
        )
        assert grid_mod.to_trimesh(solid).is_watertight

    def test_watertight_with_finger_holes_and_a_connector(self):
        pocket = _square_pocket(20.0)
        fingers = [(0.0, 11.0, 4.0)]
        connector = from_shapely(box(-2.0, 9.0, 2.0, 15.0))
        pockets = [(pocket, 10.0, fingers, connector)]
        solid = grid_mod.bin_solid(2, 1, 3, pockets=pockets, bevel_pockets=True)
        assert grid_mod.to_trimesh(solid).is_watertight

    def test_rounds_finger_holes_and_their_connector_too(self):
        # Finger holes/connector sit partly outside the pocket's own
        # footprint (realistic — that's the whole point of finger access),
        # so rounding them removes material the pocket-only round-over
        # never would. Previously only the pocket outline itself was
        # chamfered, so these two deltas were equal.
        pocket = _square_pocket(20.0)
        fingers = [(0.0, 11.0, 4.0)]
        connector = from_shapely(box(-2.0, 9.0, 2.0, 15.0))

        def bevel_delta(pockets: list[tuple]) -> float:
            off = grid_mod.to_trimesh(
                grid_mod.bin_solid(2, 1, 3, pockets=pockets, bevel_pockets=False)
            ).volume
            on = grid_mod.to_trimesh(
                grid_mod.bin_solid(2, 1, 3, pockets=pockets, bevel_pockets=True)
            ).volume
            return off - on

        delta_with_fingers = bevel_delta([(pocket, 10.0, fingers, connector)])
        delta_pocket_only = bevel_delta([(pocket, 10.0, (), None)])
        assert delta_with_fingers > delta_pocket_only + 1e-6

    def test_degrades_to_no_bevel_rather_than_erroring_at_a_very_thin_wall(self):
        # min_wall_mm well under any bevel radius: the clamp should drop the
        # bevel to (near) zero, not raise or produce a broken mesh.
        thin = grid_mod.to_trimesh(_bin_with_pocket(
            bevel_pockets=True, size=39.0, min_wall_mm=0.2,
        ))
        plain = grid_mod.to_trimesh(_bin_with_pocket(bevel_pockets=False, size=39.0))
        assert thin.is_watertight
        assert thin.volume == pytest.approx(plain.volume, rel=0.01)

    def test_clamped_to_the_pocket_depth_rather_than_erroring(self):
        mesh = grid_mod.to_trimesh(_bin_with_pocket(bevel_pockets=True, depth=0.1))
        assert mesh.volume > 0

    def test_no_effect_off_the_fast_path_general_construction(self):
        # fill_height_pct < 100 routes through the general (deck+wall+shelf)
        # construction, which never cuts a plain pocket cavity — bevel_pockets
        # is a documented no-op there (see bin_solid's docstring).
        plain = grid_mod.to_trimesh(grid_mod.bin_solid(
            2, 1, 3, pocket=_square_pocket(), pocket_depth=10.0,
            fill_height_pct=50.0, bevel_pockets=False,
        )).volume
        beveled = grid_mod.to_trimesh(grid_mod.bin_solid(
            2, 1, 3, pocket=_square_pocket(), pocket_depth=10.0,
            fill_height_pct=50.0, bevel_pockets=True,
        )).volume
        assert beveled == pytest.approx(plain)


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _seed_two_tools():
    library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
    ))
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
    ))


class TestBevelPocketsRequestWiring:
    def test_defaults_to_true_when_omitted_from_the_request(self, client, library_dir):
        _seed_two_tools()
        response = client.post("/api/library/combine/preview.glb", json={"ids": ["tool-a", "tool-b"]})
        assert response.status_code == 200
        assert response.headers["content-type"] == "model/gltf-binary"

    def test_can_be_explicitly_disabled(self, client, library_dir):
        _seed_two_tools()
        response = client.post(
            "/api/library/combine/preview.glb",
            json={"ids": ["tool-a", "tool-b"], "bevel_pockets": False},
        )
        assert response.status_code == 200

    def test_persists_on_a_saved_bin_and_round_trips_through_reopen(self, client, library_dir):
        _seed_two_tools()
        saved = client.post("/api/bins", json={
            "ids": ["tool-a", "tool-b"], "label": "No-bevel bin", "bevel_pockets": False,
        }).json()
        assert saved["bevel_pockets"] is False

        listed = client.get("/api/bins").json()["bins"]
        assert next(b for b in listed if b["id"] == saved["id"])["bevel_pockets"] is False

    def test_legacy_saved_bin_without_the_field_backfills_to_true(self, tmp_path, monkeypatch):
        # A JSON record predating this field (no "bevel_pockets" key at all)
        # should load with the new default — Pydantic's own missing-key
        # behaviour is the backfill here, same as every other bool flag on
        # SavedBin (see gridshot/core/binlibrary.py).
        from gridshot.core import binlibrary as binlibrary_mod

        monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
        legacy = binlibrary_mod.SavedBin.model_validate({
            "id": "bin-legacy", "tool_ids": ["tool-a"],
            "placements": [{"id": "tool-a", "tx": 0.0, "ty": 0.0}],
        })
        assert legacy.bevel_pockets is True
