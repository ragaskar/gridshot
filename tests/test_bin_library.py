"""Bin Library: saving a multi-tool combine-editor arrangement as a named,
reopenable/exportable entry independent of the tool library. A saved bin
stores its recipe (placements, overrides, bin-wide settings) — but each
tool_id itself is forked into a private bin-tool copy at save time (see
gridshot/core/bintools.py), so the saved bin is frozen to each tool's state
as of that save: it stops referencing the Tool Library entirely from that
point on, immune to later edits or deletion of the original."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import binlibrary as binlibrary_mod
from gridshot.core import bintools as bintools_mod
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


class TestBinToolResolution:
    """The combine pipeline resolves a `bintool-` id from the bin-tools store
    exactly like a library id, everywhere a saved bin touches a tool
    (gridshot/core/bintools.py's resolve_tool, wired into _combine_layout and
    _bin_json — this test exercises those two call sites without needing the
    fork-at-save or Duplicate endpoint that will start producing such ids)."""

    def test_combine_preview_and_save_and_export_work_with_a_bin_tool_id(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
        ))
        bintools_mod.save(library_mod.LibraryTool(
            id="bintool-1-aaaaaa", label="Pliers copy", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        ))

        preview = client.post(
            "/api/library/combine/preview", json={"ids": ["tool-a", "bintool-1-aaaaaa"]},
        )
        assert preview.status_code == 200
        assert {t["id"] for t in preview.json()["tools"]} == {"tool-a", "bintool-1-aaaaaa"}

        saved = client.post(
            "/api/bins", json={"ids": ["tool-a", "bintool-1-aaaaaa"], "label": "Mixed"},
        ).json()
        assert saved["tool_labels"] == ["Wrench", "Pliers copy"]

        export = client.post(f"/api/bins/{saved['id']}/export")
        assert export.status_code == 200


class TestForkAtSave:
    """Saving forks every tool into a private bin-tool copy (_fork_new_tools
    in app.py) — these tests cover the two failure modes that matter most:
    a per-tool override silently vanishing because it's keyed by an id that
    no longer exists after the fork, and a second save re-forking (and thus
    orphaning) tools the client already holds forked ids for."""

    def test_a_per_tool_override_survives_save_then_reopen(self, client, library_dir):
        _seed_two_tools()

        saved = client.post("/api/bins", json={
            "ids": ["tool-a", "tool-b"],
            "label": "With override",
            "overrides": [{"id": "tool-a", "clearance_mm": 3.5}],
        }).json()

        override = saved["overrides"][0]
        assert override["id"] in saved["tool_ids"]  # remapped, not the stale "tool-a"
        assert override["clearance_mm"] == 3.5

        # reopening re-derives geometry honouring the (remapped) override
        preview = client.post("/api/library/combine/preview", json={
            "ids": saved["tool_ids"],
            "overrides": saved["overrides"],
        }).json()
        overridden_tool = next(t for t in preview["tools"] if t["id"] == override["id"])
        assert overridden_tool["clearance_mm"] == 3.5

    def test_a_second_save_in_the_session_reuses_the_already_forked_ids(self, client, library_dir):
        _seed_two_tools()
        first = _save_bin(client, label="First").json()
        bin_id = first["id"]
        first_tool_ids = first["tool_ids"]

        # simulates the client adopting the forked ids after the first save,
        # same as CombineEditor is required to (see Phase 3)
        second = client.put(f"/api/bins/{bin_id}", json={
            "ids": first_tool_ids, "label": "First",
        }).json()

        assert second["tool_ids"] == first_tool_ids
        # no orphaned second copy left behind
        for tid in first_tool_ids:
            assert bintools_mod.load(tid).id == tid

    def test_a_stale_second_save_forks_fresh_copies_instead_of_reusing(self, client, library_dir):
        """If the client *doesn't* adopt the forked ids (e.g. Save As from a
        session that never reopened), the still-raw ids it resends are
        forked again — a fresh, independent set, not an error."""
        _seed_two_tools()
        first = _save_bin(client, label="First").json()

        second = client.post(
            "/api/bins", json={"ids": ["tool-a", "tool-b"], "label": "Second"},
        ).json()

        assert set(second["tool_ids"]).isdisjoint(first["tool_ids"])

    def test_editing_the_original_library_tool_does_not_change_a_saved_bin(self, client, library_dir):
        _seed_two_tools()
        saved = _save_bin(client).json()
        forked_a = next(
            tid for tid, label in zip(saved["tool_ids"], saved["tool_labels"]) if label == "Wrench"
        )

        edited = library_mod.load("tool-a").model_copy(update={"clearance_mm": 9.9})
        library_mod.save(edited)

        assert bintools_mod.load(forked_a).clearance_mm != 9.9
        assert bintools_mod.load(forked_a).clearance_mm == library_mod.LibraryTool(
            id="x", outline=TOOL_A_OUTLINE, thickness_mm=4.0,
        ).clearance_mm  # the un-overridden default clearance_mm, frozen at save time


class TestBinLibrary:
    def test_save_lists_the_bin_with_tool_labels(self, client, library_dir):
        _seed_two_tools()

        response = _save_bin(client)

        assert response.status_code == 200
        body = response.json()
        assert body["label"] == "My Bin"
        # each tool_id is forked into its own private bin-tool copy at save time
        assert len(body["tool_ids"]) == 2
        assert all(bintools_mod.is_bin_tool_id(tid) for tid in body["tool_ids"])
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

        # saved placements are keyed by the forked bin-tool ids, not the
        # original library ids the preview used — join by label instead.
        labels = dict(zip(saved["tool_ids"], saved["tool_labels"]))
        by_label = {labels[p["id"]]: p for p in saved["placements"]}
        for tool in preview["tools"]:
            placement = by_label[tool["label"]]
            assert placement["tx"] == pytest.approx(tool["tx"], abs=0.05)
            assert placement["ty"] == pytest.approx(tool["ty"], abs=0.05)
            assert placement["rot"] == pytest.approx(tool["rot"], abs=0.05)

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

    def test_saving_with_a_single_tool_succeeds(self, client, library_dir):
        _seed_two_tools()

        response = client.post("/api/bins", json={"ids": ["tool-a"], "label": "Just one"})

        assert response.status_code == 200
        assert response.json()["tool_ids"] == ["tool-a"] or len(response.json()["tool_ids"]) == 1

    def test_saving_with_no_tools_succeeds_and_produces_a_blank_bin(self, client, library_dir):
        response = client.post(
            "/api/bins",
            json={"ids": [], "label": "Blank", "force_gx": 1, "force_gy": 5},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["tool_ids"] == []
        assert body["force_gx"] == 1
        assert body["force_gy"] == 5

        export = client.post(f"/api/bins/{body['id']}/export")
        assert export.status_code == 200
        assert export.headers["content-type"] == "model/3mf"
        assert len(export.content) > 0

    def test_a_newly_saved_bin_is_unaffected_by_deleting_the_source_library_tool(self, client, library_dir):
        """Fork-at-save means a bin saved through the normal API no longer
        references the library tool at all once saved — deleting the
        original afterward doesn't touch it."""
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
        assert listed["tool_labels"] == ["Wrench", "Pliers", "Screwdriver"]

        response = client.post(f"/api/bins/{bin_id}/export")
        assert response.status_code == 200

    def test_a_legacy_bin_referencing_a_since_deleted_library_tool_still_lists_and_exports(
        self, client, library_dir,
    ):
        """Bins saved before fork-at-save existed still hold raw library ids
        — resolve_tool's library fallback and the "(deleted tool)" label
        path both stay, purely for this legacy case."""
        _seed_two_tools()
        library_mod.save(library_mod.LibraryTool(
            id="tool-c", label="Screwdriver",
            outline=Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]),
            thickness_mm=2.0,
        ))
        saved = binlibrary_mod.save_bin(binlibrary_mod.SavedBin(
            id=binlibrary_mod.new_bin_id(),
            label="Legacy Three",
            tool_ids=["tool-a", "tool-b", "tool-c"],
            placements=[
                binlibrary_mod.SavedBinPlacement(id=tid, tx=i * 40.0, ty=0.0, rot=0.0)
                for i, tid in enumerate(["tool-a", "tool-b", "tool-c"])
            ],
        ))

        library_mod.delete("tool-c")

        listed = client.get("/api/bins").json()["bins"][0]
        assert listed["id"] == saved.id
        assert listed["tool_labels"] == ["Wrench", "Pliers", None]

        response = client.post(f"/api/bins/{saved.id}/export")
        assert response.status_code == 200
