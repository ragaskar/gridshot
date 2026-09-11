"""Whether a library tool's physical cutout has been hand-edited away from
its accepted photo selection — `_cutout_diverged`/`_photo_derived_outline` in
app.py, surfaced as `diverged`/`photo_baseline` on `GET .../outline` and
`diverged`/`cutout_outline` on `GET .../photo-outline`. Exercised here
without a stored calibration, so `_photo_derived_outline` is the identity
transform of `raw_outline` and divergence reduces to "does outline differ
from raw_outline" — the parallax math itself is exercised elsewhere; this
file is about the new comparison/wiring, not that math."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from gridshot.core import library as library_mod
from gridshot.core.models import Poly
from gridshot.server import app as app_module

OUTLINE = Poly(exterior=[(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])
HAND_EDITED_OUTLINE = Poly(exterior=[(-10.0, -5.0), (12.0, -5.0), (10.0, 5.0), (-10.0, 5.0)])


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


class TestCutoutDivergence:
    def test_unedited_tool_is_not_diverged(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=OUTLINE, raw_outline=OUTLINE, thickness_mm=4.0,
        ))

        response = client.get("/api/library/tool-a/outline")

        assert response.status_code == 200
        body = response.json()
        assert body["diverged"] is False
        assert body["photo_baseline"] == json.loads(OUTLINE.model_dump_json())

    def test_a_hand_edited_cutout_diverges_from_its_photo_baseline(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench",
            outline=HAND_EDITED_OUTLINE, raw_outline=OUTLINE, thickness_mm=4.0,
        ))

        response = client.get("/api/library/tool-a/outline")

        assert response.status_code == 200
        body = response.json()
        assert body["diverged"] is True
        # The baseline a "Revert to photo selection" would restore is the
        # accepted photo selection, not the current (edited) cutout.
        assert body["photo_baseline"] == json.loads(OUTLINE.model_dump_json())
        assert body["outline"] == json.loads(HAND_EDITED_OUTLINE.model_dump_json())

    def test_physical_edit_via_patch_sets_diverged(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench", outline=OUTLINE, raw_outline=OUTLINE, thickness_mm=4.0,
        ))

        patch = client.patch("/api/library/tool-a", json={
            "outline": HAND_EDITED_OUTLINE.model_dump(),
            "edit_source": "physical",
        })
        assert patch.status_code == 200

        response = client.get("/api/library/tool-a/outline")
        assert response.json()["diverged"] is True
        # The photo selection (raw_outline) itself must survive untouched —
        # a physical edit changes only the cutout, see _apply_outline.
        assert library_mod.load("tool-a").raw_outline == OUTLINE

    def test_a_non_physical_edit_resets_divergence(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench",
            outline=HAND_EDITED_OUTLINE, raw_outline=OUTLINE, thickness_mm=4.0,
        ))
        assert client.get("/api/library/tool-a/outline").json()["diverged"] is True

        # e.g. a SAM re-segmentation or the photo-pixel outline editor: both
        # always re-derive the cutout from the (possibly new) photo
        # selection, so any prior physical divergence is gone.
        patch = client.patch("/api/library/tool-a", json={
            "outline": OUTLINE.model_dump(),
            "raw_outline": OUTLINE.model_dump(),
            "edit_source": "manual",
        })
        assert patch.status_code == 200

        assert client.get("/api/library/tool-a/outline").json()["diverged"] is False

    def test_photo_outline_without_a_stored_photo_still_reports_diverged(self, client, library_dir):
        library_mod.save(library_mod.LibraryTool(
            id="tool-a", label="Wrench",
            outline=HAND_EDITED_OUTLINE, raw_outline=OUTLINE, thickness_mm=4.0,
        ))

        response = client.get("/api/library/tool-a/photo-outline")

        assert response.status_code == 200
        body = response.json()
        assert body["has_photo"] is False
        assert body["diverged"] is True


def _photo_calibration() -> "app_module.Calibration":
    from gridshot.core.models import Calibration

    identity = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    return Calibration(
        mat_id="t", K=identity, H_img_to_mm=identity,
        camera_height_mm=1000.0, nadir_xy_mm=(100.0, 100.0),
        n_corners=4, reproj_rms_px=0.1,
    )


def _seed_photo_tool(tool_id: str, *, diverged: bool) -> None:
    """A tool with a real stored photo + working (identity-projection)
    calibration, so `_regen_photo_thumb`'s dual-outline/legend path — and the
    lazy self-heal in the /photo-thumb route — actually run end to end, not
    just the identity (no-calibration) shortcut the tests above use."""
    from PIL import Image

    from gridshot.core import parallax as parallax_mod
    from gridshot.core.models import Poly

    calibration = _photo_calibration()
    thickness_mm = 10.0
    raw = Poly(exterior=[(80.0, 80.0), (120.0, 80.0), (120.0, 120.0), (80.0, 120.0)])
    baseline = parallax_mod.correct_polygon(raw, calibration, thickness_mm)
    outline = (
        Poly(exterior=[(70.0, 70.0), (130.0, 70.0), (130.0, 130.0), (70.0, 130.0)])
        if diverged else baseline
    )
    tool = library_mod.LibraryTool(
        id=tool_id, label="Wrench", outline=outline, raw_outline=raw,
        thickness_mm=thickness_mm, has_photo=True, calibration=calibration,
    )
    library_mod.save(tool)
    Image.new("RGB", (200, 200), (128, 128, 128)).save(
        library_mod.library_dir() / f"{tool_id}-photo.jpg"
    )


class TestPhotoThumbDivergenceOverlay:
    def test_regen_draws_a_second_outline_and_stamps_the_render_version_only_when_diverged(
        self, library_dir,
    ):
        _seed_photo_tool("undiverged", diverged=False)
        _seed_photo_tool("diverged", diverged=True)

        app_module._regen_photo_thumb(library_mod.load("undiverged"))
        app_module._regen_photo_thumb(library_mod.load("diverged"))

        undiverged_thumb = library_mod.library_dir() / "undiverged-photo-thumb.jpg"
        diverged_thumb = library_mod.library_dir() / "diverged-photo-thumb.jpg"
        assert undiverged_thumb.is_file() and diverged_thumb.is_file()
        # Drawing a second outline + legend must actually change the pixels.
        assert undiverged_thumb.read_bytes() != diverged_thumb.read_bytes()
        for tid in ("undiverged", "diverged"):
            version = (library_mod.library_dir() / f"{tid}-photo-thumb.v").read_text()
            assert version == str(app_module._THUMB_RENDER_VERSION)

    def test_photo_thumb_route_self_heals_a_stale_render_version(self, client, library_dir):
        _seed_photo_tool("diverged", diverged=True)
        app_module._regen_photo_thumb(library_mod.load("diverged"))
        thumb_path = library_mod.library_dir() / "diverged-photo-thumb.jpg"
        version_path = library_mod.library_dir() / "diverged-photo-thumb.v"
        stale_bytes = thumb_path.read_bytes()
        # Simulate a thumbnail baked by an older deploy, before this render
        # version's divergence overlay existed.
        version_path.write_text("0")

        response = client.get("/api/library/diverged/photo-thumb")

        assert response.status_code == 200
        assert version_path.read_text() == str(app_module._THUMB_RENDER_VERSION)
        # Re-rendered, not served stale — same content the direct regen call
        # above produces isn't guaranteed byte-identical run to run, but the
        # version stamp having moved forward is: regeneration actually ran.
        assert thumb_path.read_bytes() != b""
