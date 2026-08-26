"""Force an exact bin footprint (gx x gy gridfinity units) for the multi-tool
combine editor's auto-pack: `force_gx`/`force_gy` on `CombineRequest` bound
`binpack.pack()`'s search, and a too-small forced size surfaces as a 422
naming the offending tool instead of silently growing the bin."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])
TOOL_B_OUTLINE = Poly(exterior=[(-8.0, -4.0), (8.0, -4.0), (8.0, 4.0), (-8.0, 4.0)])


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


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


class TestCombineForceSize:
    def test_forced_size_that_fits_returns_exactly_that_grid(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, force_gx=6, force_gy=6)

        assert response.status_code == 200
        body = response.json()
        assert body["gx"] == 6
        assert body["gy"] == 6

    def test_forced_size_too_small_returns_422_with_a_useful_message(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, force_gx=1, force_gy=1)

        assert response.status_code == 422
        detail = response.json()["detail"]
        assert "Wrench" in detail or "Pliers" in detail

    def test_setting_only_one_of_force_gx_force_gy_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, force_gx=3)

        assert response.status_code == 422

    def test_rotation_lock_and_forced_size_compose(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client,
            force_gx=6, force_gy=6,
            overrides=[{"id": "tool-a", "locked_rotation_deg": 15.0}],
        )

        assert response.status_code == 200
        body = response.json()
        assert body["gx"] == 6
        assert body["gy"] == 6
        tool_a = next(t for t in body["tools"] if t["id"] == "tool-a")
        assert tool_a["rot"] == 15.0


class TestForcedSizeManualPlacementsDontRecentre:
    """A forced size gives the bin a stable, fixed frame. Submitting a manual
    re-arrange (e.g. after dragging one tool near an edge) must not silently
    re-centre every tool around the group's own (now off-centre) bounding
    box — that reads as the whole arrangement "repacking" itself, and made
    the 3D preview (which round-trips the same way) disagree with the 2D
    view after a drag."""

    def test_off_center_manual_placements_are_returned_unshifted(self, client, library_dir):
        _seed_two_tools()
        placements = [
            {"id": "tool-a", "tx": 40.0, "ty": 25.0, "rot": 0.0},
            {"id": "tool-b", "tx": 60.0, "ty": 25.0, "rot": 0.0},
        ]

        response = _preview(client, placements=placements, force_gx=6, force_gy=6)

        assert response.status_code == 200
        body = response.json()
        tool_a = next(t for t in body["tools"] if t["id"] == "tool-a")
        tool_b = next(t for t in body["tools"] if t["id"] == "tool-b")
        assert tool_a["tx"] == pytest.approx(40.0)
        assert tool_a["ty"] == pytest.approx(25.0)
        assert tool_b["tx"] == pytest.approx(60.0)
        assert tool_b["ty"] == pytest.approx(25.0)

    def test_off_center_manual_placements_without_a_forced_size_still_recentre(self, client, library_dir):
        # Unforced (auto-fit) bins still track the tool group, so re-centring
        # here is intentional and must be unaffected by the fix above.
        _seed_two_tools()
        placements = [
            {"id": "tool-a", "tx": 40.0, "ty": 25.0, "rot": 0.0},
            {"id": "tool-b", "tx": 60.0, "ty": 25.0, "rot": 0.0},
        ]

        response = _preview(client, placements=placements)

        assert response.status_code == 200
        body = response.json()
        tool_a = next(t for t in body["tools"] if t["id"] == "tool-a")
        tool_b = next(t for t in body["tools"] if t["id"] == "tool-b")
        assert tool_a["tx"] != pytest.approx(40.0)
        assert tool_b["tx"] != pytest.approx(60.0)

    def test_preserve_placements_opts_an_unforced_bin_out_of_recentring(self, client, library_dir):
        # Same off-centre placements as the test above, but with
        # preserve_placements set: a resized toolshape's own geometry
        # changed while every tx/ty stayed put, so recentring here would
        # shift the *other* tool for no reason the user asked for.
        _seed_two_tools()
        placements = [
            {"id": "tool-a", "tx": 40.0, "ty": 25.0, "rot": 0.0},
            {"id": "tool-b", "tx": 60.0, "ty": 25.0, "rot": 0.0},
        ]

        response = _preview(client, placements=placements, preserve_placements=True)

        assert response.status_code == 200
        body = response.json()
        tool_a = next(t for t in body["tools"] if t["id"] == "tool-a")
        tool_b = next(t for t in body["tools"] if t["id"] == "tool-b")
        assert tool_a["tx"] == pytest.approx(40.0)
        assert tool_a["ty"] == pytest.approx(25.0)
        assert tool_b["tx"] == pytest.approx(60.0)
        assert tool_b["ty"] == pytest.approx(25.0)
