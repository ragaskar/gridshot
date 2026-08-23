"""Per-tool mirror toggle in the multi-tool combine editor: `mirror_x`/
`mirror_y` on a `Placement` flip a tool's own outline about its local axes
before rotation — an independent transform from `rot`, since a mirror (odd
number of axis flips) can't be expressed as any rotation."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from shapely.affinity import scale as sscale

from gridshot.core import binlibrary as binlibrary_mod
from gridshot.core import contour as contour_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

# Asymmetric outline (narrower at +x than -x) so an x-mirror is geometrically
# detectable, not a no-op.
TOOL_A_OUTLINE = Poly(exterior=[(-20.0, -10.0), (10.0, -10.0), (10.0, 10.0), (-20.0, 10.0)])
TOOL_B_OUTLINE = Poly(exterior=[(-15.0, -8.0), (15.0, -8.0), (15.0, 8.0), (-15.0, 8.0)])


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


def _placements(mirror_x=False, mirror_y=False):
    return [
        {"id": "tool-a", "tx": 0.0, "ty": 0.0, "rot": 0.0, "mirror_x": mirror_x, "mirror_y": mirror_y},
        {"id": "tool-b", "tx": 80.0, "ty": 0.0, "rot": 0.0},
    ]


def _layout(placements):
    req = app_module.CombineRequest(
        ids=["tool-a", "tool-b"], placements=placements,
        force_gx=6, force_gy=4,
    )
    return app_module._combine_layout(req)


class TestCombineMirror:
    def test_mirror_x_flips_the_placed_pocket_about_local_x(self, library_dir):
        # Compared by geometry (symmetric difference), not vertex-by-vertex:
        # mirroring reverses the ring's winding, and shapely/contour_mod may
        # re-canonicalise the tessellated (rounded-corner) ring's start
        # vertex, so raw point-order comparison isn't meaningful here.
        _seed_two_tools()
        plain = _layout(_placements())
        mirrored = _layout(_placements(mirror_x=True))

        expected = sscale(contour_mod.to_shapely(plain["centered"][0]), xfact=-1, yfact=1, origin=(0, 0))
        actual = contour_mod.to_shapely(mirrored["centered"][0])
        assert expected.symmetric_difference(actual).area < 1e-6
        assert actual.symmetric_difference(contour_mod.to_shapely(plain["centered"][0])).area > 0.1

    def test_mirror_y_flips_the_placed_pocket_about_local_y(self, library_dir):
        _seed_two_tools()
        plain = _layout(_placements())
        mirrored = _layout(_placements(mirror_y=True))

        expected = sscale(contour_mod.to_shapely(plain["centered"][0]), xfact=1, yfact=-1, origin=(0, 0))
        actual = contour_mod.to_shapely(mirrored["centered"][0])
        assert expected.symmetric_difference(actual).area < 1e-6

    def test_no_mirror_is_a_no_op(self, library_dir):
        _seed_two_tools()
        a = _layout(_placements())
        b = _layout(_placements(mirror_x=False, mirror_y=False))
        assert a["centered"][0].exterior == pytest.approx(b["centered"][0].exterior)

    def test_mirror_flags_round_trip_through_preview_response(self, client, library_dir):
        _seed_two_tools()
        response = client.post("/api/library/combine/preview", json={
            "ids": ["tool-a", "tool-b"],
            "placements": _placements(mirror_x=True),
            "force_gx": 6, "force_gy": 4,
        })
        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        tool_b = next(t for t in response.json()["tools"] if t["id"] == "tool-b")
        assert tool_a["mirror_x"] is True
        assert tool_a["mirror_y"] is False
        assert tool_b["mirror_x"] is False

    def test_saved_bin_persists_and_reapplies_mirror(self, client, library_dir):
        _seed_two_tools()
        save_response = client.post("/api/bins", json={
            "ids": ["tool-a", "tool-b"],
            "placements": _placements(mirror_x=True, mirror_y=True),
            "force_gx": 6, "force_gy": 4,
            "label": "Mirrored bin",
        })
        assert save_response.status_code == 200
        saved_id = save_response.json()["id"]

        saved = binlibrary_mod.load_bin(saved_id)
        placement_a = next(p for p in saved.placements if p.id != saved.tool_ids[1])
        assert placement_a.mirror_x is True
        assert placement_a.mirror_y is True

        req = app_module._combine_request_from_saved_bin(saved)
        assert req.placements is not None
        reloaded_a = next(p for p in req.placements if p.mirror_x or p.mirror_y)
        assert reloaded_a.mirror_x is True
        assert reloaded_a.mirror_y is True
