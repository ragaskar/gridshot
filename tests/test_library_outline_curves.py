"""The physical-cutout editor's "Edit curves" control graph (`outline_curves`
on LibraryTool) round-trips only for a physical edit that supplies one, and
is invalidated the moment outline moves on through any other route — see
_apply_outline in gridshot/server/app.py."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])
ROUNDED_OUTLINE = Poly(exterior=[
    (-10.0, -2.0), (-9.5, -3.9), (-7, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0),
])
CURVES = {
    "exterior": [
        {"p": [-10.0, -5.0], "h_in": 3.0, "h_out": 3.0},
        {"p": [10.0, -5.0], "h_in": None, "h_out": None},
        {"p": [10.0, 5.0], "h_in": None, "h_out": None},
        {"p": [-10.0, 5.0], "h_in": None, "h_out": None},
    ],
    "holes": [],
}


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def _seed(**overrides):
    library_mod.save(library_mod.LibraryTool(
        id="tool-a", label="Wrench", outline=OUTLINE, raw_outline=OUTLINE, thickness_mm=4.0,
        **overrides,
    ))


_CURVE_SEGMENTS = 10


def _lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _towards(a, b, dist_along):
    d = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
    t = 0.0 if d < 1e-9 else min(1.0, max(0.0, dist_along / d))
    return _lerp(a, b, t)


def _bake_one_eased_corner(square, corner_index, handle_mm):
    """Mirrors PhysicalCutoutEditor.tsx's bakeCornerRing exactly, for a
    single-square fixture with exactly one eased corner — the same shape a
    real "Edit curves" session would send to PATCH .../outline."""
    n = len(square)
    node = square[corner_index]
    prev = square[(corner_index - 1) % n]
    nxt = square[(corner_index + 1) % n]
    p1 = _towards(node, prev, handle_mm)
    p2 = _towards(node, nxt, handle_mm)
    curve = [
        _lerp(_lerp(p1, node, s / _CURVE_SEGMENTS), _lerp(node, p2, s / _CURVE_SEGMENTS), s / _CURVE_SEGMENTS)
        for s in range(_CURVE_SEGMENTS + 1)
    ]
    out = list(curve)
    for i in range(1, n):
        out.append(square[(corner_index + i) % n])
    return out


def _minimal_calibration():
    from gridshot.core.models import Calibration

    identity = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    return Calibration(
        mat_id="t", K=identity, H_img_to_mm=identity, n_corners=4, reproj_rms_px=0.1,
        camera_height_mm=1000.0, nadir_xy_mm=(0.0, 0.0),
    )


class TestOutlineCurvesPersistence:
    def test_a_physical_edit_with_curves_round_trips_them(self, client, library_dir):
        _seed()

        patch = client.patch("/api/library/tool-a", json={
            "outline": ROUNDED_OUTLINE.model_dump(),
            "outline_curves": CURVES,
            "edit_source": "physical",
        })
        assert patch.status_code == 200

        response = client.get("/api/library/tool-a/outline").json()
        assert response["outline_curves"] == CURVES

    def test_a_physical_edit_without_curves_clears_any_stored_graph(self, client, library_dir):
        _seed()
        client.patch("/api/library/tool-a", json={
            "outline": ROUNDED_OUTLINE.model_dump(), "outline_curves": CURVES, "edit_source": "physical",
        })
        assert client.get("/api/library/tool-a/outline").json()["outline_curves"] is not None

        # An older client (or Batch/Result's PhysicalCutoutEditor, which
        # never sends curve state) makes a plain physical edit — the stale
        # graph from before must not survive it uninvited.
        client.patch("/api/library/tool-a", json={
            "outline": OUTLINE.model_dump(), "edit_source": "physical",
        })

        assert client.get("/api/library/tool-a/outline").json()["outline_curves"] is None

    def test_a_non_physical_edit_invalidates_the_curve_graph(self, client, library_dir):
        _seed()
        client.patch("/api/library/tool-a", json={
            "outline": ROUNDED_OUTLINE.model_dump(), "outline_curves": CURVES, "edit_source": "physical",
        })

        # e.g. a SAM re-segmentation: recomputes outline from a fresh photo
        # selection, unrelated to whatever curve graph produced the old one.
        client.patch("/api/library/tool-a", json={
            "outline": OUTLINE.model_dump(), "raw_outline": OUTLINE.model_dump(), "edit_source": "manual",
        })

        assert client.get("/api/library/tool-a/outline").json()["outline_curves"] is None

    def test_a_thickness_change_invalidates_the_curve_graph(self, client, library_dir):
        _seed(calibration=_minimal_calibration())
        client.patch("/api/library/tool-a", json={
            "outline": ROUNDED_OUTLINE.model_dump(), "outline_curves": CURVES, "edit_source": "physical",
        })

        response = client.patch("/api/library/tool-a", json={"thickness_mm": 6.0})
        assert response.status_code == 200

        assert client.get("/api/library/tool-a/outline").json()["outline_curves"] is None

    def test_a_non_outline_edit_leaves_the_curve_graph_alone(self, client, library_dir):
        # Changing something unrelated (clearance) never touches outline at
        # all — no reason for it to disturb a valid curve graph.
        _seed()
        client.patch("/api/library/tool-a", json={
            "outline": ROUNDED_OUTLINE.model_dump(), "outline_curves": CURVES, "edit_source": "physical",
        })

        client.patch("/api/library/tool-a", json={"clearance_mm": 1.5})

        assert client.get("/api/library/tool-a/outline").json()["outline_curves"] == CURVES

    def test_cloning_a_tool_preserves_its_curve_graph(self, client, library_dir):
        _seed()
        client.patch("/api/library/tool-a", json={
            "outline": ROUNDED_OUTLINE.model_dump(), "outline_curves": CURVES, "edit_source": "physical",
        })

        cloned = library_mod.clone("tool-a", "tool-a-clone")

        assert cloned.outline_curves is not None
        assert json.loads(cloned.outline_curves.model_dump_json()) == CURVES
        assert cloned.outline_curves_revision == cloned.outline_revision

    def test_the_stored_outline_still_bakes_exactly_from_the_stored_curve_graph(self, client, library_dir):
        """The actual bug this class exists to catch: _validated_physical_outline
        simplifies a hand-edited outline (contour_mod.clean's default
        simplify_tol), which used to thin a densely-sampled eased corner's
        points below what its outline_curves graph bakes to — silently
        breaking resolveInitialCornerPoly's match on the client and losing
        the corner's editability the moment it's saved, not on some later
        edit. Verified end-to-end against the real bake algorithm, not a
        hand-picked "close enough" outline fixture like the other tests in
        this file use for their (orthogonal) staleness-clearing behaviour."""
        _seed()
        square = [(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]
        baked = _bake_one_eased_corner(square, 0, handle_mm=3.0)
        curves = {
            "exterior": [
                {"p": list(square[0]), "h_in": 3.0, "h_out": 3.0},
                {"p": list(square[1]), "h_in": None, "h_out": None},
                {"p": list(square[2]), "h_in": None, "h_out": None},
                {"p": list(square[3]), "h_in": None, "h_out": None},
            ],
            "holes": [],
        }

        patch = client.patch("/api/library/tool-a", json={
            "outline": {"exterior": [list(p) for p in baked], "holes": []},
            "outline_curves": curves,
            "edit_source": "physical",
        })
        assert patch.status_code == 200

        stored = library_mod.load("tool-a")
        assert stored.outline_curves_revision == stored.outline_revision
        rebaked = _bake_one_eased_corner(square, 0, handle_mm=3.0)
        assert len(stored.outline.exterior) == len(rebaked)
        for got, want in zip(stored.outline.exterior, rebaked):
            assert got[0] == pytest.approx(want[0], abs=1e-6)
            assert got[1] == pytest.approx(want[1], abs=1e-6)
