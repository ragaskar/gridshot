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


class TestCreateToolshapeEndpoint:
    def test_creates_a_bin_tool_with_a_generated_outline(self, client, config_dir):
        response = client.post("/api/bin-tools/toolshape", json={
            "type": "rounded_rect", "width_mm": 30.0, "length_mm": 30.0,
            "radius_mm": 1.0, "fillet_bottom": False,
        })

        assert response.status_code == 200
        body = response.json()
        assert body["id"].startswith("bintool-")
        assert body["toolshape_type"] == "rounded_rect"
        assert body["toolshape_width_mm"] == 30.0
        assert body["derived_key"] is not None  # outline itself is stripped; heavy

    def test_never_appears_in_the_tool_library(self, client, config_dir):
        client.post("/api/bin-tools/toolshape", json={
            "type": "rounded_rect", "width_mm": 30.0, "length_mm": 30.0,
            "radius_mm": 1.0, "fillet_bottom": False,
        })

        assert client.get("/api/library").json()["tools"] == []

    def test_rejects_nonpositive_dimensions(self, client, config_dir):
        response = client.post("/api/bin-tools/toolshape", json={
            "type": "rounded_rect", "width_mm": 0.0, "length_mm": 30.0,
            "radius_mm": 1.0, "fillet_bottom": False,
        })

        assert response.status_code == 422


class TestUpdateToolshapeEndpoint:
    def _create(self, client):
        return client.post("/api/bin-tools/toolshape", json={
            "type": "rounded_rect", "width_mm": 30.0, "length_mm": 30.0,
            "radius_mm": 1.0, "fillet_bottom": False,
        }).json()

    def test_updates_params_and_regenerates_the_outline(self, client, config_dir):
        created = self._create(client)

        response = client.patch(
            f"/api/bin-tools/{created['id']}/toolshape", json={"width_mm": 50.0},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["toolshape_width_mm"] == 50.0
        assert body["derived_key"] != created["derived_key"]  # outline changed

    def test_404s_for_an_unknown_id(self, client, config_dir):
        response = client.patch(
            "/api/bin-tools/bintool-no-such-id/toolshape", json={"width_mm": 50.0},
        )

        assert response.status_code == 404

    def test_422s_for_a_non_toolshape_bin_tool(self, client, config_dir):
        bintools_mod.save(library_mod.LibraryTool(
            id="bintool-1-aaaaaa", label="Copy 1", outline=OUTLINE, thickness_mm=4.0,
        ))

        response = client.patch(
            "/api/bin-tools/bintool-1-aaaaaa/toolshape", json={"width_mm": 50.0},
        )

        assert response.status_code == 422

    def test_404s_for_a_library_tool_id(self, client, config_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=OUTLINE, thickness_mm=4.0,
        ))

        response = client.patch(
            "/api/bin-tools/tool-a/toolshape", json={"width_mm": 50.0},
        )

        assert response.status_code == 404
