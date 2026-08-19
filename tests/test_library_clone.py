"""Cloning a library tool: `library.clone()` duplicates an entry under a new
id — same outline/settings/history/provenance, plus its thumbnail/photo
assets on disk — so the clone can be selected alongside the original for a
combine/compose bin without any instance-id plumbing."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_OUTLINE = Poly(
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


def _seed_tool(**overrides) -> library_mod.LibraryTool:
    kwargs = dict(id="tool-a", label="Wrench", outline=TOOL_OUTLINE, thickness_mm=4.0)
    kwargs.update(overrides)
    return library_mod.save(library_mod.LibraryTool(**kwargs))


class TestLibraryClone:
    def test_clone_gets_a_new_id_and_matches_the_source_otherwise(self, library_dir):
        source = _seed_tool()

        cloned = library_mod.clone("tool-a", "tool-a-clone")

        assert cloned.id == "tool-a-clone"
        assert cloned.id != source.id
        assert cloned.label == "Wrench (copy)"
        assert cloned.outline == source.outline
        assert cloned.clearance_mm == source.clearance_mm
        assert cloned.thickness_mm == source.thickness_mm

    def test_deleting_the_clone_does_not_affect_the_source(self, library_dir):
        _seed_tool()
        library_mod.clone("tool-a", "tool-a-clone")

        library_mod.delete("tool-a-clone")

        assert library_mod.load("tool-a") is not None
        with pytest.raises(KeyError):
            library_mod.load("tool-a-clone")

    def test_thumbnail_and_photo_assets_are_copied_independently(self, library_dir):
        _seed_tool()
        thumb = library_mod.library_dir() / "tool-a.png"
        photo = library_mod.library_dir() / "tool-a-photo.jpg"
        thumb.write_bytes(b"thumb")
        photo.write_bytes(b"photo")

        library_mod.clone("tool-a", "tool-a-clone")

        cloned_thumb = library_mod.library_dir() / "tool-a-clone.png"
        cloned_photo = library_mod.library_dir() / "tool-a-clone-photo.jpg"
        assert cloned_thumb.read_bytes() == b"thumb"
        assert cloned_photo.read_bytes() == b"photo"
        assert thumb.read_bytes() == b"thumb"
        assert photo.read_bytes() == b"photo"

    def test_cloning_a_nonexistent_tool_raises_key_error(self, library_dir):
        with pytest.raises(KeyError):
            library_mod.clone("no-such-tool", "new-id")

    def test_clone_route_returns_404_for_a_nonexistent_tool(self, client, library_dir):
        response = client.post("/api/library/no-such-tool/clone")

        assert response.status_code == 404

    def test_clone_route_returns_the_new_tool(self, client, library_dir):
        _seed_tool()

        response = client.post("/api/library/tool-a/clone")

        assert response.status_code == 200
        body = response.json()
        assert body["id"] != "tool-a"
        assert body["label"] == "Wrench (copy)"

    def test_cloned_tool_is_independently_combinable(self, client, library_dir):
        _seed_tool()
        clone_id = client.post("/api/library/tool-a/clone").json()["id"]

        response = client.post(
            "/api/library/combine/preview",
            json={"ids": ["tool-a", clone_id]},
        )

        assert response.status_code == 200
        assert len(response.json()["tools"]) == 2
