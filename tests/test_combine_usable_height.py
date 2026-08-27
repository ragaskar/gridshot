"""The multi-tool combine preview reports `usable_height_mm` — the depth
actually available below the "100% fill" reference (finished height minus
base, floor, and any lip) — plus the raw terms (`base_h_mm`,
`floor_thickness_mm`, `lip_height_mm`) a client needs to convert a desired
usable height back into `overall_height` without duplicating gridfinity.py's
own constants."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import gridfinity as grid_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _seed_two_tools():
    library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=TOOL_OUTLINE, thickness_mm=4.0,
    ))
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=TOOL_OUTLINE, thickness_mm=3.0,
    ))


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


class TestUsableHeightFields:
    def test_reports_usable_height_and_its_terms(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overall_height=60, lip=True)

        assert response.status_code == 200
        body = response.json()
        assert body["base_h_mm"] == grid_mod.BASE_H
        assert body["floor_thickness_mm"] == grid_mod.FLOOR_THICKNESS
        assert body["lip_height_mm"] == grid_mod.LIP_H
        expected_usable = (
            body["overall_height_mm"] - grid_mod.BASE_H - grid_mod.FLOOR_THICKNESS - grid_mod.LIP_H
        )
        assert body["usable_height_mm"] == pytest.approx(expected_usable, abs=0.05)

    def test_lipless_bin_does_not_subtract_a_lip(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overall_height=60, lip=False)

        assert response.status_code == 200
        body = response.json()
        expected_usable = body["overall_height_mm"] - grid_mod.BASE_H - grid_mod.FLOOR_THICKNESS
        assert body["usable_height_mm"] == pytest.approx(expected_usable, abs=0.05)

    def test_custom_floor_and_lip_height_overrides_are_reflected(self, client, library_dir):
        _seed_two_tools()

        response = _preview(
            client, overall_height=80, lip=True,
            floor_thickness_mm=2.5, lip_height_mm=3.0,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["floor_thickness_mm"] == pytest.approx(2.5)
        assert body["lip_height_mm"] == pytest.approx(3.0)
        expected_usable = body["overall_height_mm"] - grid_mod.BASE_H - 2.5 - 3.0
        assert body["usable_height_mm"] == pytest.approx(expected_usable, abs=0.05)

    def test_usable_height_round_trips_through_overall_height_for_usable(self):
        # The client's own conversion (usable + base + floor + lip) is exactly
        # the inverse of usable_height_for_overall — pin that relationship
        # directly, independent of the HTTP layer above.
        overall = 63.4
        usable = grid_mod.usable_height_for_overall(
            overall, lip=True, floor_thickness_mm=1.2, lip_height_mm=4.4,
        )
        reconstructed = usable + grid_mod.BASE_H + 1.2 + 4.4
        assert reconstructed == pytest.approx(overall)
