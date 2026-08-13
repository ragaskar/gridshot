"""POST /api/calibration/signatures — batch triage before any board detection."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.server import app as app_module


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def fake_ingest(monkeypatch, source_factory):
    """Serve a scripted SourceImage per upload, in upload order.

    Real decoding is bypassed: this route only reads EXIF and pixel
    dimensions, and synthesising EXIF-bearing HEICs would test Pillow.
    """
    scripted: list = []

    def install(sources):
        scripted.clear()
        scripted.extend(sources)
        calls = iter(scripted)
        monkeypatch.setattr(
            app_module.ingest_mod, "load", lambda path: next(calls)
        )

    return install


def upload(count: int, name: str = "IMG_{i}.HEIC") -> list:
    return [
        ("files", (name.format(i=i), b"not-really-an-image", "image/heic"))
        for i in range(1, count + 1)
    ]


def test_majority_setup_is_green_and_the_rest_red(
    client, fake_ingest, source_factory
):
    fake_ingest(
        [
            source_factory(),
            source_factory(),
            source_factory(width=20),
            source_factory(),
            source_factory(digital_zoom_ratio=2.0),
        ]
    )

    response = client.post("/api/calibration/signatures", files=upload(5))

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 5
    assert body["matching_count"] == 3
    assert [row["matches"] for row in body["rows"]] == [
        True,
        True,
        False,
        True,
        False,
    ]
    assert [row["name"] for row in body["rows"]] == [
        f"IMG_{i}.HEIC" for i in range(1, 6)
    ]
    assert [row["index"] for row in body["rows"]] == [1, 2, 3, 4, 5]


def test_rows_carry_the_raw_signature_fields(
    client, fake_ingest, source_factory
):
    fake_ingest([source_factory(width=4032, height=3024)])

    body = client.post("/api/calibration/signatures", files=upload(1)).json()

    signature = body["rows"][0]["signature"]
    # Raw, as EXIF recorded it — normalisation happens only when comparing.
    assert signature["device_make"] == "Apple"
    assert signature["device_model"] == "iPhone 15 Pro"
    assert signature["image_size"] == [4032, 3024]
    assert signature["orientation_deg"] == 0
    assert signature["mirrored"] is False
    assert signature["focal_mm"] == pytest.approx(6.765)
    assert signature["focal_35mm"] == pytest.approx(24.0)
    assert signature["digital_zoom_ratio"] == pytest.approx(1.0)
    assert body["canonical_signature"] == signature


def test_mismatch_rows_name_the_offending_fields(
    client, fake_ingest, source_factory
):
    fake_ingest(
        [source_factory(), source_factory(), source_factory(focal_mm=2.2)]
    )

    body = client.post("/api/calibration/signatures", files=upload(3)).json()

    assert body["rows"][2]["mismatch_fields"] == ["focal_mm"]
    assert "focal_mm" in body["rows"][2]["reason"]
    assert body["rows"][0]["mismatch_fields"] == []
    assert body["rows"][0]["reason"] == ""


def test_enough_matching_photos_clears_calibration(
    client, fake_ingest, source_factory
):
    minimum = app_module.calibrate_mod.MIN_INTRINSICS_VIEWS
    fake_ingest([source_factory() for _ in range(minimum)])

    body = client.post(
        "/api/calibration/signatures", files=upload(minimum)
    ).json()

    assert body["min_views"] == minimum
    assert body["can_calibrate"] is True


def test_too_few_matching_photos_blocks_calibration(
    client, fake_ingest, source_factory
):
    minimum = app_module.calibrate_mod.MIN_INTRINSICS_VIEWS
    fake_ingest(
        [source_factory() for _ in range(minimum - 1)]
        + [source_factory(width=20) for _ in range(3)]
    )

    body = client.post(
        "/api/calibration/signatures", files=upload(minimum + 2)
    ).json()

    assert body["matching_count"] == minimum - 1
    assert body["can_calibrate"] is False


def test_mirrored_photos_are_reported_never_canonical(
    client, fake_ingest, source_factory
):
    fake_ingest(
        [source_factory(orientation_mirrored=True), source_factory()]
    )

    body = client.post("/api/calibration/signatures", files=upload(2)).json()

    assert body["rows"][0]["matches"] is False
    assert body["rows"][0]["mismatch_fields"] == ["mirrored"]
    assert body["canonical_signature"]["mirrored"] is False


def test_the_route_never_runs_board_detection(
    client, fake_ingest, source_factory, monkeypatch
):
    """Triage stays fast: it must not touch the ChArUco path."""

    def explode(*args, **kwargs):
        raise AssertionError("signature triage must not detect corners")

    monkeypatch.setattr(app_module.calibrate_mod, "detect_corners", explode)
    fake_ingest([source_factory(), source_factory()])

    assert (
        client.post("/api/calibration/signatures", files=upload(2)).status_code
        == 200
    )


def test_unreadable_photo_is_reported_by_name(
    client, monkeypatch, source_factory
):
    def boom(path):
        raise OSError("cannot identify image file")

    monkeypatch.setattr(app_module.ingest_mod, "load", boom)

    response = client.post("/api/calibration/signatures", files=upload(1))

    assert response.status_code == 422
    assert "IMG_1.HEIC" in response.json()["detail"]
    assert "cannot identify image file" in response.json()["detail"]


def test_upload_with_no_files_is_rejected(client):
    """Pins the contract, not the layer — FastAPI's own `File(...)` validation
    answers this before the handler's guard is reached."""
    assert client.post("/api/calibration/signatures", files=[]).status_code == 422
