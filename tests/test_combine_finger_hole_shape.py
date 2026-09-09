"""End-to-end: a "rounded_rect" finger hole actually cuts the real 3D solid
built by the multi-tool combine editor (not just the 2D preview metadata) —
see test_finger_hole_shape.py for the underlying derive.py geometry, and
test_combine_mirror.py for this module's harness conventions."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import gridfinity as grid_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_OUTLINE = Poly(exterior=[(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)])


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=TOOL_OUTLINE, thickness_mm=4.0,
    ))
    return tmp_path


def _solid_volume(overrides):
    req = app_module.CombineRequest(
        ids=["tool-a"],
        placements=[{"id": "tool-a", "tx": 0.0, "ty": 0.0, "rot": 0.0}],
        overrides=overrides,
        force_gx=4, force_gy=3,
    )
    solid = app_module._combine_solid(req)
    return grid_mod.to_trimesh(solid).volume


class TestCombineRoundedRectFingerHole:
    def test_rounded_rect_hole_removes_more_material_than_no_hole(self, library_dir):
        no_hole = _solid_volume([{"id": "tool-a", "finger_hole": False}])
        with_hole = _solid_volume([{
            "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
            "finger_hole_shape": "rounded_rect",
            "finger_hole_length_mm": 20.0, "finger_hole_width_mm": 10.0,
            "finger_hole_corner_radius_mm": 2.0,
        }])
        assert with_hole < no_hole

    def test_a_bigger_rounded_rect_removes_more_material_than_a_smaller_one(self, library_dir):
        small = _solid_volume([{
            "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
            "finger_hole_shape": "rounded_rect",
            "finger_hole_length_mm": 10.0, "finger_hole_width_mm": 6.0,
            "finger_hole_corner_radius_mm": 1.0,
        }])
        big = _solid_volume([{
            "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
            "finger_hole_shape": "rounded_rect",
            "finger_hole_length_mm": 30.0, "finger_hole_width_mm": 10.0,
            "finger_hole_corner_radius_mm": 1.0,
        }])
        assert big < small

    def test_switching_shape_alone_changes_the_solid(self, library_dir):
        # Same nominal footprint (diameter == hypot(length, width)) — the
        # rect and circle still cut visibly different volumes, confirming
        # the rounded-rect path isn't silently falling back to a circle.
        circular = _solid_volume([{
            "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
            "finger_hole_shape": "circular",
            "finger_hole_diameter_mm": (20.0 ** 2 + 10.0 ** 2) ** 0.5,
        }])
        rounded_rect = _solid_volume([{
            "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
            "finger_hole_shape": "rounded_rect",
            "finger_hole_length_mm": 20.0, "finger_hole_width_mm": 10.0,
            "finger_hole_corner_radius_mm": 2.0,
        }])
        assert circular != pytest.approx(rounded_rect, rel=1e-3)

    def test_span_rounded_rect_holes_both_get_cut(self, library_dir):
        single = _solid_volume([{
            "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
            "finger_hole_shape": "rounded_rect",
            "finger_hole_length_mm": 16.0, "finger_hole_width_mm": 8.0,
            "finger_hole_corner_radius_mm": 1.0,
        }])
        span = _solid_volume([{
            "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
            "finger_hole_span": True, "finger_hole_arc2_mm": 10.0,
            "finger_hole_shape": "rounded_rect",
            "finger_hole_length_mm": 16.0, "finger_hole_width_mm": 8.0,
            "finger_hole_corner_radius_mm": 1.0,
        }])
        assert span < single

    def test_preview_response_reports_the_resolved_shape_fields(self, client, library_dir):
        response = client.post("/api/library/combine/preview", json={
            "ids": ["tool-a"],
            "placements": [{"id": "tool-a", "tx": 0.0, "ty": 0.0, "rot": 0.0}],
            "overrides": [{
                "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
                "finger_hole_shape": "rounded_rect",
                "finger_hole_length_mm": 18.0, "finger_hole_width_mm": 9.0,
                "finger_hole_corner_radius_mm": 1.5,
            }],
            "force_gx": 4, "force_gy": 3,
        })
        assert response.status_code == 200
        tool = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool["finger_hole_shape"] == "rounded_rect"
        assert tool["finger_hole_shape_override"] == "rounded_rect"
        assert tool["finger_hole_shape_inherited"] == "circular"
        assert tool["finger_hole_length_mm"] == 18.0
        assert tool["finger_hole_width_mm"] == 9.0
        assert tool["finger_hole_corner_radius_mm"] == 1.5
        assert tool["finger_holes"][0][2] == pytest.approx((18.0 ** 2 + 9.0 ** 2) ** 0.5, abs=0.01)

    def test_a_placement_with_mirror_still_cuts_the_expected_volume(self, library_dir):
        # The oriented-rect construction bakes orientation into the poly's
        # own local-frame vertices (see derive._finger_hole_shape_polygon),
        # so it should ride through _mirror_local unchanged in volume —
        # mirroring an isometry, the cut removes exactly as much material.
        req_plain = app_module.CombineRequest(
            ids=["tool-a"],
            placements=[{"id": "tool-a", "tx": 0.0, "ty": 0.0, "rot": 0.0, "mirror_x": False}],
            overrides=[{
                "id": "tool-a", "finger_hole": True, "finger_hole_arc_mm": 0.0,
                "finger_hole_shape": "rounded_rect",
                "finger_hole_length_mm": 16.0, "finger_hole_width_mm": 8.0,
                "finger_hole_corner_radius_mm": 1.0,
            }],
            force_gx=4, force_gy=3,
        )
        req_mirrored = req_plain.model_copy(update={
            "placements": [app_module.Placement(id="tool-a", tx=0.0, ty=0.0, rot=0.0, mirror_x=True)],
        })
        vol_plain = grid_mod.to_trimesh(app_module._combine_solid(req_plain)).volume
        vol_mirrored = grid_mod.to_trimesh(app_module._combine_solid(req_mirrored)).volume
        assert vol_plain == pytest.approx(vol_mirrored, rel=1e-6)
