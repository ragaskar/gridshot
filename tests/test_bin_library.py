"""Bin Library: saving a multi-tool combine-editor arrangement as a named,
reopenable/exportable entry independent of the tool library. A saved bin
stores its recipe (tool ids, placements, overrides, bin-wide settings), not
a frozen geometry snapshot — export/reopen always regenerate from the
tools' current library state, the same as the live combine editor."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(
    exterior=[(-30.0, -10.0), (30.0, -10.0), (30.0, 10.0), (-30.0, 10.0)]
)
TOOL_B_OUTLINE = Poly(
    exterior=[(-15.0, -8.0), (15.0, -8.0), (15.0, 8.0), (-15.0, 8.0)]
)


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


def _save_bin(client, label="My Bin", **body):
    return client.post("/api/bins", json={"ids": ["tool-a", "tool-b"], "label": label, **body})


class TestBinLibrary:
    def test_save_lists_the_bin_with_tool_labels(self, client, library_dir):
        _seed_two_tools()

        response = _save_bin(client)

        assert response.status_code == 200
        body = response.json()
        assert body["label"] == "My Bin"
        assert body["tool_ids"] == ["tool-a", "tool-b"]
        assert body["tool_labels"] == ["Wrench", "Pliers"]
        assert body["created_ts"] > 0
        assert len(body["placements"]) == 2

        listed = client.get("/api/bins").json()["bins"]
        assert len(listed) == 1
        assert listed[0]["id"] == body["id"]

    def test_save_stores_the_applied_profile_id(self, client, library_dir):
        _seed_two_tools()

        response = _save_bin(client, applied_profile_id="seed-corral")

        assert response.status_code == 200
        assert response.json()["applied_profile_id"] == "seed-corral"
        listed = client.get("/api/bins").json()["bins"][0]
        assert listed["applied_profile_id"] == "seed-corral"

    def test_overwrite_replaces_the_recipe_keeping_the_same_id(self, client, library_dir):
        _seed_two_tools()
        original = _save_bin(client, label="Original", lip=True).json()
        bin_id = original["id"]

        response = client.put(
            f"/api/bins/{bin_id}",
            json={"ids": ["tool-a", "tool-b"], "label": "Original", "lip": False, "applied_profile_id": "p1"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == bin_id
        assert body["created_ts"] == original["created_ts"]
        assert body["lip"] is False
        assert body["applied_profile_id"] == "p1"

        listed = client.get("/api/bins").json()["bins"]
        assert len(listed) == 1
        assert listed[0]["lip"] is False

    def test_overwrite_404s_for_a_nonexistent_bin(self, client, library_dir):
        _seed_two_tools()

        response = client.put(
            "/api/bins/no-such-bin", json={"ids": ["tool-a", "tool-b"], "label": "X"},
        )

        assert response.status_code == 404

    def test_rename_updates_the_listing(self, client, library_dir):
        _seed_two_tools()
        bin_id = _save_bin(client, label="Original").json()["id"]

        response = client.patch(f"/api/bins/{bin_id}", json={"label": "Renamed"})

        assert response.status_code == 200
        assert response.json()["label"] == "Renamed"
        listed = client.get("/api/bins").json()["bins"]
        assert listed[0]["label"] == "Renamed"

    def test_delete_removes_it_and_is_idempotent(self, client, library_dir):
        _seed_two_tools()
        bin_id = _save_bin(client).json()["id"]

        first = client.delete(f"/api/bins/{bin_id}")
        second = client.delete(f"/api/bins/{bin_id}")

        assert first.json() == {"deleted": True}
        assert second.json() == {"deleted": False}
        assert client.get("/api/bins").json()["bins"] == []

    def test_saved_placements_match_a_live_preview_of_the_same_request(self, client, library_dir):
        _seed_two_tools()

        saved = _save_bin(client).json()
        preview = client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"]}).json()

        by_id = {p["id"]: p for p in saved["placements"]}
        for tool in preview["tools"]:
            assert by_id[tool["id"]]["tx"] == pytest.approx(tool["tx"], abs=0.05)
            assert by_id[tool["id"]]["ty"] == pytest.approx(tool["ty"], abs=0.05)
            assert by_id[tool["id"]]["rot"] == pytest.approx(tool["rot"], abs=0.05)

    def test_export_returns_a_3mf(self, client, library_dir):
        _seed_two_tools()
        bin_id = _save_bin(client).json()["id"]

        response = client.post(f"/api/bins/{bin_id}/export")

        assert response.status_code == 200
        assert response.headers["content-type"] == "model/3mf"
        assert len(response.content) > 0

    def test_export_slice_returns_a_3mf(self, client, library_dir):
        _seed_two_tools()
        bin_id = _save_bin(client).json()["id"]

        response = client.post(f"/api/bins/{bin_id}/export/slice", json={})

        assert response.status_code == 200
        assert response.headers["content-type"] == "model/3mf"

    def test_export_404s_for_a_nonexistent_bin(self, client, library_dir):
        response = client.post("/api/bins/no-such-bin/export")

        assert response.status_code == 404

    def test_saving_with_fewer_than_two_tools_is_rejected(self, client, library_dir):
        _seed_two_tools()

        response = client.post("/api/bins", json={"ids": ["tool-a"], "label": "Too few"})

        assert response.status_code == 422

    def test_a_bin_referencing_a_since_deleted_tool_still_lists_and_exports(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-c", label="Screwdriver",
            outline=Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]),
            thickness_mm=2.0,
        ))
        _seed_two_tools()
        bin_id = client.post(
            "/api/bins", json={"ids": ["tool-a", "tool-b", "tool-c"], "label": "Three"},
        ).json()["id"]

        library_mod.delete("tool-c")

        listed = client.get("/api/bins").json()["bins"][0]
        assert listed["tool_labels"] == ["Wrench", "Pliers", None]

        response = client.post(f"/api/bins/{bin_id}/export")
        assert response.status_code == 200
