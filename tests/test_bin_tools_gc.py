"""Bin-tool garbage collection (Phase 4 of the duplicate-tools plan):
deleting a saved bin cleans up its own unshared bin-tools, and the
`gridshot bin-tools gc` CLI catches anything that slips through (a
Duplicate or fork-at-save whose session was never saved)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from gridshot.cli.main import app as cli_app
from gridshot.core import bintools as bintools_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

OUTLINE_A = Poly(exterior=[(-30.0, -10.0), (30.0, -10.0), (30.0, 10.0), (-30.0, 10.0)])
OUTLINE_B = Poly(exterior=[(-15.0, -8.0), (15.0, -8.0), (15.0, 8.0), (-15.0, 8.0)])


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _seed_two_tools():
    library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=OUTLINE_A, thickness_mm=4.0,
    ))
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=OUTLINE_B, thickness_mm=3.0,
    ))


class TestBinDeleteGc:
    def test_deleting_a_bin_removes_its_own_unshared_bin_tools(self, client, config_dir):
        _seed_two_tools()
        saved = client.post(
            "/api/bins", json={"ids": ["tool-a", "tool-b"], "label": "Mine"},
        ).json()
        forked_ids = saved["tool_ids"]
        assert all(bintools_mod.is_bin_tool_id(tid) for tid in forked_ids)

        client.delete(f"/api/bins/{saved['id']}")

        for tid in forked_ids:
            with pytest.raises(KeyError):
                bintools_mod.load(tid)

    def test_deleting_one_of_two_bins_sharing_a_bin_tool_keeps_it(self, client, config_dir):
        _seed_two_tools()
        first = client.post(
            "/api/bins", json={"ids": ["tool-a", "tool-b"], "label": "First"},
        ).json()
        # Save As from the reopened session, adopting the already-forked ids
        # — this is exactly how two bins end up sharing bin-tool ids.
        second = client.post(
            "/api/bins", json={"ids": first["tool_ids"], "label": "Second"},
        ).json()
        assert second["tool_ids"] == first["tool_ids"]

        client.delete(f"/api/bins/{first['id']}")

        for tid in second["tool_ids"]:
            assert bintools_mod.load(tid).id == tid  # still alive — Second still uses it


class TestGcCli:
    def test_gc_deletes_bin_tools_no_saved_bin_references(self, client, config_dir):
        _seed_two_tools()
        # duplicated mid-session, then the session was closed without saving
        orphan = client.post("/api/bin-tools/tool-a/duplicate").json()

        result = CliRunner().invoke(cli_app, ["bin-tools", "gc"])

        assert result.exit_code == 0
        assert orphan["id"] in result.output
        with pytest.raises(KeyError):
            bintools_mod.load(orphan["id"])

    def test_gc_leaves_bin_tools_a_saved_bin_still_references_alone(self, client, config_dir):
        _seed_two_tools()
        saved = client.post(
            "/api/bins", json={"ids": ["tool-a", "tool-b"], "label": "Mine"},
        ).json()

        result = CliRunner().invoke(cli_app, ["bin-tools", "gc"])

        assert result.exit_code == 0
        assert "nothing to do" in result.output
        for tid in saved["tool_ids"]:
            assert bintools_mod.load(tid).id == tid

    def test_gc_is_a_noop_with_no_bin_tools_at_all(self, config_dir):
        result = CliRunner().invoke(cli_app, ["bin-tools", "gc"])

        assert result.exit_code == 0
        assert "nothing to do" in result.output
