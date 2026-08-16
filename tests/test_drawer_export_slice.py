"""POST /api/library/export (drawer zip): each bin regenerated via
finalize_bin now also produces a trace-tolerance slice, so the drawer export
should bundle it under slices/ alongside the full bin's 3MF."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from gridshot.core.library import LibraryTool
from gridshot.core.models import Poly
from gridshot.server import app as app_module


@pytest.fixture
def client():
    return TestClient(app_module.app)


TOOL_OUTLINE = Poly(
    exterior=[(-30.0, -10.0), (30.0, -10.0), (30.0, 10.0), (-30.0, 10.0)]
)


def _tool(tid: str, label: str, **overrides) -> LibraryTool:
    kwargs = dict(id=tid, label=label, outline=TOOL_OUTLINE, thickness_mm=4.0)
    kwargs.update(overrides)
    return LibraryTool(**kwargs)


class TestDrawerExportSlice:
    def test_zip_includes_a_slice_per_bin(self, client, monkeypatch):
        tools = {t.id: t for t in [_tool("a", "Wrench"), _tool("b", "Pliers")]}
        monkeypatch.setattr(app_module.library_mod, "load", lambda tid: tools[tid])

        response = client.post(
            "/api/library/export", json={"ids": ["a", "b"], "cols": 4, "rows": 2}
        )

        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            names = zf.namelist()
        assert "slices/Wrench-slice.3mf" in names
        assert "slices/Pliers-slice.3mf" in names
        # the full bins are still there too — slices are additive
        assert "bins/Wrench.3mf" in names
        assert "bins/Pliers.3mf" in names

    def test_manifest_records_the_slice_filename(self, client, monkeypatch):
        tools = {t.id: t for t in [_tool("a", "Wrench")]}
        monkeypatch.setattr(app_module.library_mod, "load", lambda tid: tools[tid])

        response = client.post(
            "/api/library/export", json={"ids": ["a"], "cols": 2, "rows": 2}
        )

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert manifest["bins"][0]["slice_file"] == "slices/Wrench-slice.3mf"

    def test_a_pocket_too_shallow_for_a_slice_omits_it_without_failing(
        self, client, monkeypatch
    ):
        """A legacy tool with a hand-set, very shallow recess shouldn't break
        the whole drawer export — it just has no slice file."""
        import gridshot.core.gridfinity as grid_mod

        shallow = _tool(
            "a", "Sticker", pocket_depth_mm=grid_mod.MIN_SLICE_THICKNESS_MM / 2
        )
        monkeypatch.setattr(
            app_module.library_mod, "load", lambda tid: {"a": shallow}[tid]
        )

        response = client.post(
            "/api/library/export", json={"ids": ["a"], "cols": 2, "rows": 2}
        )

        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            names = zf.namelist()
            manifest = json.loads(zf.read("manifest.json"))
        assert not any(n.startswith("slices/") for n in names)
        assert manifest["bins"][0]["slice_file"] is None
