"""Custom bin shape: `removed_cells` on `CombineRequest` cuts individual
gridfinity units out of a [forced-size](test_combine_force_size.py)
pocket-style bin, rounding both the outer and notch corners. Requires
force_gx/force_gy, pocket style, a single connected remaining shape, and no
tool geometry crossing into a removed cell."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import binlibrary as binlibrary_mod
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


# Auto-pack (no explicit placements) into a forced 4x1 strip, with the
# far-right cell (3,0) removed: auto-pack has no notion of removed cells, so
# this only stays reliable because the grid is generously wide relative to
# the tools and the far end is left untouched — auto-pack packs them
# compactly near the middle. Overlap-with-a-removed-cell is exercised
# separately below with exact placements calibrated against this same tool
# pair/grid, since (by design) placements are re-centred on the group's own
# bounding box and can't be aimed at a specific cell by construction alone.
FAR_CELL_REMOVED = {"force_gx": 4, "force_gy": 1, "removed_cells": [[3, 0]]}

# tool-a/tool-b's actual centred positions for this tool pair on a forced
# 4x1 grid with no mask (confirmed idempotent: feeding them back as explicit
# placements reproduces the same centred result) — used below to aim
# tool-a squarely at cell (1,0), centred at world x=-21.
CALIBRATED_PLACEMENTS = [
    {"id": "tool-a", "tx": -12.67, "ty": -1.18, "rot": 0.0},
    {"id": "tool-b", "tx": 13.75, "ty": -1.72, "rot": 0.0},
]


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


class TestCustomBinShape:
    def test_valid_l_shape_builds_and_reports_the_forced_grid(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, **FAR_CELL_REMOVED)

        assert response.status_code == 200
        body = response.json()
        assert body["gx"] == 4
        assert body["gy"] == 1

    def test_export_bin_with_custom_shape_succeeds(self, client, library_dir):
        _seed_two_tools()

        response = client.post("/api/library/combine", json={
            "ids": ["tool-a", "tool-b"], **FAR_CELL_REMOVED,
        })

        assert response.status_code == 200
        assert len(response.content) > 0

    def test_removed_cells_without_forced_size_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = client.post("/api/library/combine/preview", json={
            "ids": ["tool-a", "tool-b"], "removed_cells": [[0, 0]],
        })

        assert response.status_code == 422

    def test_removed_cells_with_non_pocket_style_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client, force_gx=2, force_gy=2, removed_cells=[[0, 0]], bin_style="corral",
        )

        assert response.status_code == 422

    def test_disconnected_shape_is_rejected(self, client, library_dir):
        _seed_two_tools()

        # 3x1 strip with the middle cell removed splits into two islands.
        response = client.post("/api/library/combine/preview", json={
            "ids": ["tool-a", "tool-b"],
            "placements": [
                {"id": "tool-a", "tx": -42.0, "ty": 0.0, "rot": 0.0},
                {"id": "tool-b", "tx": 42.0, "ty": 0.0, "rot": 0.0},
            ],
            "force_gx": 3, "force_gy": 1, "removed_cells": [[1, 0]],
        })

        assert response.status_code == 422
        assert "connected" in response.json()["detail"]

    def test_tool_overlapping_a_removed_cell_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = client.post("/api/library/combine/preview", json={
            "ids": ["tool-a", "tool-b"],
            "placements": CALIBRATED_PLACEMENTS,
            # 3x1 grid, end cell (0,0) removed — still connected ({1,0},{2,0}
            # remain adjacent) but its rect reaches tool-a's position.
            "force_gx": 3, "force_gy": 1, "removed_cells": [[0, 0]],
        })

        assert response.status_code == 422
        assert "Wrench" in response.json()["detail"]

    def test_save_and_reopen_round_trips_removed_cells(self, client, library_dir):
        _seed_two_tools()

        save_response = client.post("/api/bins", json={
            "ids": ["tool-a", "tool-b"], **FAR_CELL_REMOVED,
            "label": "Custom-shaped bin",
        })
        assert save_response.status_code == 200
        saved_id = save_response.json()["id"]
        assert save_response.json()["removed_cells"] == [[3, 0]]

        listed = client.get("/api/bins").json()["bins"]
        entry = next(b for b in listed if b["id"] == saved_id)
        assert entry["removed_cells"] == [[3, 0]]

        saved = binlibrary_mod.load_bin(saved_id)
        req = app_module._combine_request_from_saved_bin(saved)
        assert req.removed_cells == [(3, 0)]
        lay = app_module._combine_layout(req)
        assert lay["gx"] == 4 and lay["gy"] == 1
