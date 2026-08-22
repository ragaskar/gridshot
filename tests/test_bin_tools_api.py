"""Bin-tool REST API (Phase 2 of the duplicate-tools plan): the "⧉ Duplicate"
endpoint the Combine editor calls to fork a second, independently-editable
copy of a tool's geometry without touching the Tool Library."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import bintools as bintools_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


class TestDuplicateEndpoint:
    def test_duplicates_a_library_tool_into_a_bin_tool(self, client, config_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=OUTLINE, thickness_mm=4.0,
        ))

        response = client.post("/api/bin-tools/tool-a/duplicate")

        assert response.status_code == 200
        body = response.json()
        assert body["id"].startswith("bintool-")
        assert body["label"] == "Wrench (copy)"
        # the duplicate isn't added to the Tool Library — still just the original
        listed_ids = {t["id"] for t in client.get("/api/library").json()["tools"]}
        assert listed_ids == {"tool-a"}

    def test_duplicates_a_bin_tool(self, client, config_dir):
        bintools_mod.save(library_mod.LibraryTool(
            id="bintool-1-aaaaaa", label="Copy 1", outline=OUTLINE, thickness_mm=4.0,
        ))

        response = client.post("/api/bin-tools/bintool-1-aaaaaa/duplicate")

        assert response.status_code == 200
        assert response.json()["label"] == "Copy 1 (copy)"

    def test_404s_for_an_unknown_source_id(self, client, config_dir):
        response = client.post("/api/bin-tools/no-such-tool/duplicate")

        assert response.status_code == 404
