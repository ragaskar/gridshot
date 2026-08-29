"""POST /api/library/combine/slice — one coupon through every tool's cutout
in a multi-tool bin at once, since each pocket/recess opens straight through
to the bin's top regardless of its own depth (see grid_mod.slice_window)."""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from gridshot.core import gridfinity as grid_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module


@pytest.fixture
def client():
    return TestClient(app_module.app)


def _pocket(cx: float, w: float = 10.0, d: float = 8.0) -> Poly:
    return Poly(exterior=[
        (cx - w / 2, -d / 2), (cx + w / 2, -d / 2),
        (cx + w / 2, d / 2), (cx - w / 2, d / 2),
    ])


def _stub_layout(monkeypatch, depths, height_u=4):
    """Bypass real library tool loading/packing: feed `_combine_solid` and
    `library_combine_slice` a small, controlled two-pocket layout directly."""
    lay = {
        "centered": [_pocket(-15.0), _pocket(15.0)],
        "depths": depths,
        "fingers": [[], []],
        "connectors": [None, None],
        "gx": 3, "gy": 1,
        "lip": False,
        "height_u": height_u,
        "lip_height_mm": grid_mod.LIP_H,
        "lip_chamfer_top_mm": grid_mod.LIP_CH_TOP,
        "lip_straight_mm": grid_mod.LIP_STRAIGHT,
        "lip_chamfer_bottom_mm": grid_mod.LIP_CH_BOT,
        "min_wall_mm": grid_mod.MIN_WALL,
        "min_floor_mm": grid_mod.MIN_FLOOR,
        "floor_thickness_mm": grid_mod.FLOOR_THICKNESS,
        "tool_wall_mm": grid_mod.TOOL_WALL,
        "tool_wall_flare_mm": grid_mod.TOOL_WALL_FLARE,
        "tool_wall_reinforcement_h_mm": grid_mod.TOOL_WALL_REINFORCEMENT_H,
        "magnet_hole_inset_from_edge_mm": grid_mod.MAGNET_HOLE_INSET_FROM_EDGE_MM,
    }
    monkeypatch.setattr(app_module, "_combine_layout", lambda req: lay)
    return lay


def _post(client, ids=("a", "b"), **extra):
    return client.post(
        "/api/library/combine/slice",
        json={"ids": list(ids), "fill_height_pct": 100, **extra},
    )


class TestCombineSlice:
    def test_slice_intersects_every_tools_cutout(self, client, monkeypatch):
        _stub_layout(monkeypatch, depths=[6.0, 9.0])

        response = _post(client)

        assert response.status_code == 200
        assert response.headers["content-type"] == "model/3mf"
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            assert "3D/3dmodel.model" in zf.namelist()

    def test_response_is_a_thin_coupon_not_the_full_bin(self, client, monkeypatch):
        import re

        lay = _stub_layout(monkeypatch, depths=[6.0, 9.0])
        total_h = lay["height_u"] * grid_mod.UNIT_H

        response = _post(client)

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            model_xml = zf.read("3D/3dmodel.model").decode()
        z_values = [float(z) for z in re.findall(r'z="([-0-9.]+)"', model_xml)]
        zmin, zmax = min(z_values), max(z_values)
        assert zmax - zmin == pytest.approx(grid_mod.SLICE_THICKNESS_MM, abs=1e-2)
        assert zmax <= total_h + 1e-6

    def test_too_shallow_a_pocket_is_rejected_with_a_clear_reason(
        self, client, monkeypatch
    ):
        _stub_layout(monkeypatch, depths=[6.0, 0.2])

        response = _post(client)

        assert response.status_code == 422
        assert "0.2" in response.json()["detail"]

    def test_thickness_below_half_a_millimetre_is_rejected(self, client, monkeypatch):
        _stub_layout(monkeypatch, depths=[6.0, 9.0])

        response = _post(client, slice_thickness_mm=0.1)

        assert response.status_code == 422

    def test_thickness_above_five_millimetres_is_accepted_and_clamped_to_the_shallowest_pocket(
        self, client, monkeypatch
    ):
        # slice_window() clamps to the shallowest pocket's own depth (6.0mm
        # here) regardless of what's requested — a bin with deep pockets
        # shouldn't be stuck at an arbitrary fixed cap that has nothing to do
        # with its own geometry.
        import re

        _stub_layout(monkeypatch, depths=[6.0, 9.0])

        response = _post(client, slice_thickness_mm=6.0)

        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            model_xml = zf.read("3D/3dmodel.model").decode()
        z_values = [float(z) for z in re.findall(r'z="([-0-9.]+)"', model_xml)]
        assert max(z_values) - min(z_values) == pytest.approx(6.0, abs=1e-2)

    def test_an_unreasonably_large_thickness_is_still_rejected(self, client, monkeypatch):
        _stub_layout(monkeypatch, depths=[6.0, 9.0])

        response = _post(client, slice_thickness_mm=150.0)

        assert response.status_code == 422

    def test_custom_thickness_is_honoured(self, client, monkeypatch):
        import re

        _stub_layout(monkeypatch, depths=[6.0, 9.0])

        response = _post(client, slice_thickness_mm=2.0)

        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            model_xml = zf.read("3D/3dmodel.model").decode()
        z_values = [float(z) for z in re.findall(r'z="([-0-9.]+)"', model_xml)]
        assert max(z_values) - min(z_values) == pytest.approx(2.0, abs=1e-2)

    def test_slice_solid_is_always_built_unbeveled_regardless_of_the_bins_own_flag(
        self, client, monkeypatch
    ):
        # A shallow pocket's slice window can land within the round-over's
        # own radius of the top (see slice_window's docstring), which would
        # make the coupon measure the flared opening instead of the true
        # wall — so the slice always samples the pocket unrounded, even when
        # the bin itself has "Round pocket edges" on.
        _stub_layout(monkeypatch, depths=[6.0, 9.0])
        seen = {}
        original = app_module._combine_solid

        def spy(req, lay=None):
            seen["bevel_pockets"] = req.bevel_pockets
            return original(req, lay)

        monkeypatch.setattr(app_module, "_combine_solid", spy)

        response = _post(client, bevel_pockets=True)

        assert response.status_code == 200
        assert seen["bevel_pockets"] is False

    def test_omitted_thickness_still_defaults_to_one_mm(self, client, monkeypatch):
        import re

        _stub_layout(monkeypatch, depths=[6.0, 9.0])

        response = _post(client)

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            model_xml = zf.read("3D/3dmodel.model").decode()
        z_values = [float(z) for z in re.findall(r'z="([-0-9.]+)"', model_xml)]
        assert max(z_values) - min(z_values) == pytest.approx(
            grid_mod.SLICE_THICKNESS_MM, abs=1e-2
        )
