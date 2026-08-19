"""Per-tool rotation lock for auto-pack in the multi-tool combine editor: a
`locked_rotation_deg` override on `POST /api/library/combine/preview`
restricts that tool's auto-pack rotation search to the given angle only."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(exterior=[(-30.0, -10.0), (30.0, -10.0), (30.0, 10.0), (-30.0, 10.0)])
TOOL_B_OUTLINE = Poly(exterior=[(-15.0, -8.0), (15.0, -8.0), (15.0, 8.0), (-15.0, 8.0)])


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


class TestCombineRotationLock:
    def test_locked_rotation_is_honoured_on_auto_pack(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "locked_rotation_deg": 45.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["rot"] == 45.0

    def test_unlocked_tool_still_searches_the_full_rotation_set(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "locked_rotation_deg": 45.0}])

        assert response.status_code == 200
        tool_b = next(t for t in response.json()["tools"] if t["id"] == "tool-b")
        assert tool_b["rot"] in (0.0, 90.0, 180.0, 270.0)

    def test_locked_rotation_is_ignored_for_manual_placements(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client,
            placements=[
                {"id": "tool-a", "tx": 0.0, "ty": 0.0, "rot": 12.0},
                {"id": "tool-b", "tx": 50.0, "ty": 0.0, "rot": 0.0},
            ],
            overrides=[{"id": "tool-a", "locked_rotation_deg": 45.0}],
        )

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["rot"] == 12.0
