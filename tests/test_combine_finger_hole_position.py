"""Per-tool finger-hole position override for the multi-tool combine editor:
a bin-time `finger_hole_arc_mm` override on `POST /api/library/combine/preview`,
same shape as the clearance override — arc-length in mm along the pocket
outline, wrapped mod its perimeter."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.core import derive as derive_mod
from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

TOOL_A_OUTLINE = Poly(exterior=[(-19.0, -5.0), (19.0, -5.0), (19.0, 5.0), (-19.0, 5.0)])
TOOL_B_OUTLINE = Poly(exterior=[(-15.0, -4.0), (15.0, -4.0), (15.0, 4.0), (-15.0, 4.0)])


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
        finger_hole=True,
    ))
    library_mod.save(library_mod.LibraryTool(
        id="tool-b", label="Pliers", outline=TOOL_B_OUTLINE, thickness_mm=3.0,
        finger_hole=True,
    ))


def _preview(client, **body):
    return client.post("/api/library/combine/preview", json={"ids": ["tool-a", "tool-b"], **body})


class TestCombineFingerHolePosition:
    def test_default_response_reports_a_resolved_arc_length_and_no_override(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_arc_mm"] >= 0
        assert tool_a["finger_hole_arc_mm_override"] is None

    def test_arc_override_moves_the_finger_hole_for_one_tool_only(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")
        base_b = next(t for t in baseline["tools"] if t["id"] == "tool-b")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_arc_mm": 10.0}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["finger_hole_arc_mm"] == 10.0
        assert by_id["tool-a"]["finger_hole_arc_mm_override"] == 10.0
        assert by_id["tool-a"]["finger_holes"] != base_a["finger_holes"]
        assert by_id["tool-b"]["finger_hole_arc_mm_override"] is None
        assert by_id["tool-b"]["finger_holes"] == base_b["finger_holes"]

    def test_arc_override_wraps_around_the_perimeter(self, client, library_dir):
        _seed_two_tools()
        # perimeter of tool-a's pocket is close to, but not exactly, the raw
        # outline's 2*(38+10)=96mm once clearance/compensation apply — derive
        # from the response itself rather than hard-coding it.
        baseline = _preview(client, overrides=[{"id": "tool-a", "finger_hole_arc_mm": 0.0}]).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")

        # A very large arc-length must still resolve (wrap, not error).
        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_arc_mm": 10_000.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_arc_mm"] >= 0
        assert tool_a["finger_holes"] != base_a["finger_holes"]

    def test_legacy_override_fields_still_move_the_hole_when_no_arc_is_set(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_offset_mm": 5.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_arc_mm_override"] is None
        assert tool_a["finger_holes"] != base_a["finger_holes"]


class TestCombineFingerHoleDiameter:
    def test_default_diameter_is_20mm_and_no_override(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_holes"][0][2] == pytest.approx(20.0)
        assert tool_a["finger_hole_diameter_mm_override"] is None

    def test_diameter_override_resizes_one_tool_only(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_b = next(t for t in baseline["tools"] if t["id"] == "tool-b")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_diameter_mm": 30.0}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["finger_holes"][0][2] == pytest.approx(30.0)
        assert by_id["tool-a"]["finger_hole_diameter_mm_override"] == pytest.approx(30.0)
        assert by_id["tool-a"]["finger_hole_diameter_mm_inherited"] == pytest.approx(20.0)
        assert by_id["tool-b"]["finger_hole_diameter_mm_override"] is None
        assert by_id["tool-b"]["finger_holes"] == base_b["finger_holes"]


class TestCombineFingerHoleRadialOffset:
    """`finger_hole_radial_offset_mm` — moves the hole along the local
    outward normal of the pocket outline at its arc-length point, distinct
    from the legacy `finger_hole_offset_mm` (a bbox-axis nudge). See
    tests/test_finger_hole_radial_offset.py for the underlying geometry."""

    def test_default_offset_is_zero_and_no_override(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_radial_offset_mm"] == pytest.approx(0.0)
        assert tool_a["finger_hole_radial_offset_mm_inherited"] == pytest.approx(0.0)
        assert tool_a["finger_hole_radial_offset_mm_override"] is None

    def test_offset_override_moves_one_tools_hole_only(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")
        base_b = next(t for t in baseline["tools"] if t["id"] == "tool-b")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_radial_offset_mm": 2.0}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["finger_hole_radial_offset_mm"] == pytest.approx(2.0)
        assert by_id["tool-a"]["finger_hole_radial_offset_mm_override"] == pytest.approx(2.0)
        assert by_id["tool-a"]["finger_holes"] != base_a["finger_holes"]
        assert by_id["tool-b"]["finger_hole_radial_offset_mm_override"] is None
        assert by_id["tool-b"]["finger_holes"] == base_b["finger_holes"]

    def test_shipped_point_matches_the_shipped_stamp_and_arc_length(self, client, library_dir):
        # Regression guard for the exact bug class `derive.py`'s comment on
        # `orient(...)` and `TestFingerHoleArcMatchesShippedRing` (see
        # tests/test_finger_hole_position.py) both exist to prevent: a client
        # re-deriving a point from `finger_hole_arc_mm` against the *shipped*
        # `stamp` ring must land on the exact point the server shipped in
        # `finger_holes`, using nothing but the same formula this override is
        # built on (`_point_and_outward_normal_at_arc_length`). If the ring a
        # client walks ever disagreed with the one the server resolved the
        # override against, this would drift while every other test above —
        # which only reads the server's own numbers back — would stay green.
        _seed_two_tools()

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_radial_offset_mm": 2.0}])

        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        ring = [tuple(p) for p in tool_a["stamp"]]
        point, normal = derive_mod._point_and_outward_normal_at_arc_length(
            ring, tool_a["finger_hole_arc_mm"]
        )
        expected = (point[0] + normal[0] * 2.0, point[1] + normal[1] * 2.0)
        assert tool_a["finger_holes"][0][:2] == pytest.approx(expected, abs=1e-2)

    def test_shipped_span_points_each_match_their_own_arc_and_normal(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client, overrides=[
            {"id": "tool-a", "finger_hole_span": True, "finger_hole_radial_offset_mm": 1.5},
        ])

        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        ring = [tuple(p) for p in tool_a["stamp"]]
        for i, arc in enumerate((tool_a["finger_hole_arc_mm"], tool_a["finger_hole_arc2_mm"])):
            point, normal = derive_mod._point_and_outward_normal_at_arc_length(ring, arc)
            expected = (point[0] + normal[0] * 1.5, point[1] + normal[1] * 1.5)
            assert tool_a["finger_holes"][i][:2] == pytest.approx(expected, abs=1e-2)

    def test_negative_offset_moves_the_hole_the_other_way(self, client, library_dir):
        _seed_two_tools()
        plus = _preview(client, overrides=[{"id": "tool-a", "finger_hole_radial_offset_mm": 2.0}]).json()
        minus = _preview(client, overrides=[{"id": "tool-a", "finger_hole_radial_offset_mm": -2.0}]).json()

        plus_a = next(t for t in plus["tools"] if t["id"] == "tool-a")
        minus_a = next(t for t in minus["tools"] if t["id"] == "tool-a")
        assert plus_a["finger_holes"] != minus_a["finger_holes"]

    def test_null_override_falls_back_to_the_zero_default(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_offset_mm": 5.0}])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_radial_offset_mm_override"] is None
        assert tool_a["finger_hole_radial_offset_mm"] == pytest.approx(0.0)

    def test_persists_on_a_saved_bin_and_round_trips_through_reopen(self, client, library_dir):
        _seed_two_tools()
        saved = client.post("/api/bins", json={
            "ids": ["tool-a", "tool-b"], "label": "Offset bin",
            "overrides": [{"id": "tool-a", "finger_hole_radial_offset_mm": 2.5}],
        }).json()
        forked_a = next(o for o in saved["overrides"] if o["finger_hole_radial_offset_mm"] == pytest.approx(2.5))

        listed = client.get("/api/bins").json()["bins"]
        fetched = next(b for b in listed if b["id"] == saved["id"])
        assert any(
            o["finger_hole_radial_offset_mm"] == pytest.approx(2.5) for o in fetched["overrides"]
        )

        reopened = _preview(
            client, ids=fetched["tool_ids"],
            overrides=[{"id": forked_a["id"], "finger_hole_radial_offset_mm": 2.5}],
        ).json()
        tool = next(t for t in reopened["tools"] if t["id"] == forked_a["id"])
        assert tool["finger_hole_radial_offset_mm"] == pytest.approx(2.5)

    def test_legacy_saved_override_without_the_field_backfills_to_none(self, tmp_path, monkeypatch):
        from gridshot.core import binlibrary as binlibrary_mod

        monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
        legacy = binlibrary_mod.SavedBinOverride.model_validate({"id": "tool-a"})
        assert legacy.finger_hole_radial_offset_mm is None


class TestCombineFingerHoleSpan:
    def test_default_span_is_off_with_one_point(self, client, library_dir):
        _seed_two_tools()

        response = _preview(client)

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_span"] is False
        assert tool_a["finger_hole_span_override"] is None
        assert len(tool_a["finger_holes"]) == 1

    def test_span_override_adds_a_second_point_for_one_tool_only(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_b = next(t for t in baseline["tools"] if t["id"] == "tool-b")

        response = _preview(client, overrides=[{"id": "tool-a", "finger_hole_span": True}])

        assert response.status_code == 200
        by_id = {t["id"]: t for t in response.json()["tools"]}
        assert by_id["tool-a"]["finger_hole_span"] is True
        assert by_id["tool-a"]["finger_hole_span_override"] is True
        assert len(by_id["tool-a"]["finger_holes"]) == 2
        assert by_id["tool-b"]["finger_hole_span"] is False
        assert by_id["tool-b"]["finger_holes"] == base_b["finger_holes"]

    def test_arc2_override_moves_the_second_point(self, client, library_dir):
        _seed_two_tools()
        base = _preview(client, overrides=[{"id": "tool-a", "finger_hole_span": True}]).json()
        base_a = next(t for t in base["tools"] if t["id"] == "tool-a")

        response = _preview(client, overrides=[
            {"id": "tool-a", "finger_hole_span": True, "finger_hole_arc2_mm": 15.0},
        ])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert tool_a["finger_hole_arc2_mm"] == pytest.approx(15.0)
        assert tool_a["finger_hole_arc2_mm_override"] == pytest.approx(15.0)
        assert tool_a["finger_holes"][1] != base_a["finger_holes"][1]
        # The first point's own boundary position is untouched by moving the
        # second — raw x/y can still shift, since the overall cut envelope
        # re-centers on origin as its bounding box changes with P2's move
        # (same as the diameter-override case above).
        assert tool_a["finger_hole_arc_mm"] == pytest.approx(base_a["finger_hole_arc_mm"])

    def test_span_off_after_on_drops_the_second_point(self, client, library_dir):
        _seed_two_tools()
        baseline = _preview(client).json()
        base_a = next(t for t in baseline["tools"] if t["id"] == "tool-a")

        response = _preview(client, overrides=[
            {"id": "tool-a", "finger_hole_span": False, "finger_hole_arc2_mm": 15.0},
        ])

        assert response.status_code == 200
        tool_a = next(t for t in response.json()["tools"] if t["id"] == "tool-a")
        assert len(tool_a["finger_holes"]) == 1
        assert tool_a["finger_holes"][0] == base_a["finger_holes"][0]
