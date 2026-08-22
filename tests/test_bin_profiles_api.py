"""Bin Profiles REST API (Phase 4): CRUD, preview image upload/download, and
the synthetic preview.glb route used by the (future) profile editor page."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from gridshot.core import binprofiles as profiles_mod
from gridshot.server import app as app_module


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def profiles_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


class TestCrud:
    def test_list_self_heals_the_3_seeded_profiles(self, client, profiles_dir):
        response = client.get("/api/bin-profiles")

        assert response.status_code == 200
        names = {p["name"] for p in response.json()["profiles"]}
        assert names == {"Pocket", "Corral", "Live Grid"}

    def test_create_lists_and_gets_the_new_profile(self, client, profiles_dir):
        response = client.post("/api/bin-profiles", json={"name": "My Style", "lip": False})

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "My Style"
        assert body["lip"] is False
        assert body["has_preview_image"] is False

        got = client.get(f"/api/bin-profiles/{body['id']}").json()
        assert got["name"] == "My Style"

        listed = {p["id"] for p in client.get("/api/bin-profiles").json()["profiles"]}
        assert body["id"] in listed

    def test_create_rejects_a_duplicate_name(self, client, profiles_dir):
        client.post("/api/bin-profiles", json={"name": "Mine"})

        response = client.post("/api/bin-profiles", json={"name": "Mine"})

        assert response.status_code == 422

    def test_create_rejects_a_name_colliding_with_a_seeded_profile(self, client, profiles_dir):
        response = client.post("/api/bin-profiles", json={"name": "Pocket"})

        assert response.status_code == 422

    def test_update_renames_and_changes_fields(self, client, profiles_dir):
        profile_id = client.post("/api/bin-profiles", json={"name": "Original"}).json()["id"]

        response = client.patch(
            f"/api/bin-profiles/{profile_id}", json={"name": "Renamed", "lip": False, "min_wall_mm": 3.0},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Renamed"
        assert body["lip"] is False
        assert body["min_wall_mm"] == 3.0

    def test_create_and_update_accept_corral_edge_margin_mm(self, client, profiles_dir):
        created = client.post(
            "/api/bin-profiles", json={"name": "Framed", "corral_edge_margin_mm": 1.5},
        )

        assert created.status_code == 200
        assert created.json()["corral_edge_margin_mm"] == 1.5

        profile_id = created.json()["id"]
        updated = client.patch(f"/api/bin-profiles/{profile_id}", json={"corral_edge_margin_mm": 2.5})

        assert updated.status_code == 200
        assert updated.json()["corral_edge_margin_mm"] == 2.5

    def test_update_rejects_renaming_to_an_existing_name(self, client, profiles_dir):
        client.post("/api/bin-profiles", json={"name": "Taken"})
        profile_id = client.post("/api/bin-profiles", json={"name": "Mine"}).json()["id"]

        response = client.patch(f"/api/bin-profiles/{profile_id}", json={"name": "Taken"})

        assert response.status_code == 422

    def test_update_allows_keeping_your_own_name(self, client, profiles_dir):
        profile_id = client.post("/api/bin-profiles", json={"name": "Mine"}).json()["id"]

        response = client.patch(f"/api/bin-profiles/{profile_id}", json={"name": "Mine", "lip": False})

        assert response.status_code == 200
        assert response.json()["lip"] is False

    def test_get_404s_for_an_unknown_id(self, client, profiles_dir):
        assert client.get("/api/bin-profiles/no-such-profile").status_code == 404

    def test_update_404s_for_an_unknown_id(self, client, profiles_dir):
        assert client.patch("/api/bin-profiles/no-such-profile", json={"lip": False}).status_code == 404

    def test_delete_removes_it_and_is_idempotent(self, client, profiles_dir):
        profile_id = client.post("/api/bin-profiles", json={"name": "Mine"}).json()["id"]

        first = client.delete(f"/api/bin-profiles/{profile_id}")
        second = client.delete(f"/api/bin-profiles/{profile_id}")

        assert first.json() == {"deleted": True}
        assert second.json() == {"deleted": False}
        assert client.get(f"/api/bin-profiles/{profile_id}").status_code == 404


class TestPreviewImage:
    def test_upload_then_download_round_trips(self, client, profiles_dir):
        profile_id = client.post("/api/bin-profiles", json={"name": "Mine"}).json()["id"]
        png_bytes = b"\x89PNG\r\n\x1a\n fake-but-good-enough"

        upload = client.post(
            f"/api/bin-profiles/{profile_id}/preview",
            files={"photo": ("preview.png", io.BytesIO(png_bytes), "image/png")},
        )
        assert upload.status_code == 200

        assert client.get(f"/api/bin-profiles/{profile_id}").json()["has_preview_image"] is True
        downloaded = client.get(f"/api/bin-profiles/{profile_id}/preview")
        assert downloaded.status_code == 200
        assert downloaded.content == png_bytes

    def test_download_404s_when_no_preview_was_uploaded(self, client, profiles_dir):
        profile_id = client.post("/api/bin-profiles", json={"name": "Mine"}).json()["id"]

        assert client.get(f"/api/bin-profiles/{profile_id}/preview").status_code == 404

    def test_upload_404s_for_an_unknown_profile(self, client, profiles_dir):
        response = client.post(
            "/api/bin-profiles/no-such-profile/preview",
            files={"photo": ("preview.png", io.BytesIO(b"x"), "image/png")},
        )
        assert response.status_code == 404

    def test_delete_removes_the_preview_image_too(self, client, profiles_dir):
        profile_id = client.post("/api/bin-profiles", json={"name": "Mine"}).json()["id"]
        client.post(
            f"/api/bin-profiles/{profile_id}/preview",
            files={"photo": ("preview.png", io.BytesIO(b"x"), "image/png")},
        )

        client.delete(f"/api/bin-profiles/{profile_id}")

        assert profiles_mod.has_preview(profile_id) is False


class TestPreviewGlb:
    def test_default_pocket_preview_returns_a_valid_glb(self, client, profiles_dir):
        response = client.post("/api/bin-profiles/preview.glb", json={})

        assert response.status_code == 200
        assert response.headers["content-type"] == "model/gltf-binary"
        assert len(response.content) > 0
        assert response.content[:4] == b"glTF"

    def test_corral_style_preview_returns_a_valid_glb(self, client, profiles_dir):
        response = client.post("/api/bin-profiles/preview.glb", json={"base_style": "corral"})

        assert response.status_code == 200
        assert response.content[:4] == b"glTF"

    def test_grid_style_preview_returns_a_valid_glb(self, client, profiles_dir):
        response = client.post("/api/bin-profiles/preview.glb", json={"base_style": "grid"})

        assert response.status_code == 200
        assert response.content[:4] == b"glTF"

    def test_structural_overrides_are_honoured(self, client, profiles_dir):
        response = client.post(
            "/api/bin-profiles/preview.glb", json={"lip": True, "lip_height_mm": 12.0},
        )

        assert response.status_code == 200
        assert len(response.content) > 0
