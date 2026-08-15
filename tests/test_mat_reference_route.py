"""POST/GET /api/mats/{mat_id}/reference — empty-mat reference photo upload.

Mirrors `gridshot mat reference`: requires a verified mat, stores a canonical
warp of the empty-mat photo, and refuses an unverified one with the same
message the CLI gives (run `mat verify` first).
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pytest
from fastapi.testclient import TestClient

from gridshot.core.models import Calibration, MatProfile, MatSpec
from gridshot.server import app as app_module


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture(autouse=True)
def config_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIDSHOT_CONFIG_DIR", str(tmp_path))
    return tmp_path


def save_mat(mat_id: str = "letter-7x9-test01", *, verified: bool) -> MatProfile:
    profile = MatProfile(
        mat_id=mat_id,
        spec=MatSpec(paper="letter"),
        created_at=dt.datetime.now().isoformat(timespec="seconds"),
        verified=verified,
    )
    app_module.mat_mod.save_profile(profile)
    return profile


def fake_calibration(mat_id: str) -> Calibration:
    return Calibration(
        mat_id=mat_id,
        K=[[1000.0, 0.0, 500.0], [0.0, 1000.0, 500.0], [0.0, 0.0, 1.0]],
        H_img_to_mm=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        n_corners=42,
        reproj_rms_px=0.42,
        warnings=[],
    )


def upload(name: str = "empty-mat.jpg") -> dict:
    return {"photo": (name, b"not-really-an-image", "image/jpeg")}


def test_unverified_mat_is_refused_like_the_cli(client, source_factory, monkeypatch):
    save_mat(verified=False)
    monkeypatch.setattr(
        app_module.ingest_mod, "load", lambda path: source_factory()
    )

    response = client.post(
        "/api/mats/letter-7x9-test01/reference", files=upload()
    )

    assert response.status_code == 422
    assert "verify" in response.json()["detail"]


def test_unknown_mat_returns_404(client, source_factory, monkeypatch):
    monkeypatch.setattr(
        app_module.ingest_mod, "load", lambda path: source_factory()
    )

    response = client.post("/api/mats/does-not-exist/reference", files=upload())

    assert response.status_code == 404


def test_stores_canonical_reference_and_returns_metadata(
    client, source_factory, monkeypatch
):
    save_mat(verified=True)
    monkeypatch.setattr(
        app_module.ingest_mod, "load", lambda path: source_factory()
    )
    monkeypatch.setattr(
        app_module.calibrate_mod,
        "calibrate_image",
        lambda *a, **k: fake_calibration("letter-7x9-test01"),
    )

    response = client.post(
        "/api/mats/letter-7x9-test01/reference", files=upload()
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mat_id"] == "letter-7x9-test01"
    assert body["n_corners"] == 42
    assert body["reproj_rms_px"] == pytest.approx(0.42)
    assert body["capture_signature"]["schema_version"] == "capture.v1"
    # no device profile exists in this sandboxed config dir
    assert any("no device profile" in w for w in body["warnings"])

    ref_path = app_module.mat_mod.reference_path("letter-7x9-test01")
    assert ref_path.is_file()


def test_mats_endpoint_reports_has_reference(client, source_factory, monkeypatch):
    save_mat("with-ref", verified=True)
    save_mat("without-ref", verified=True)
    monkeypatch.setattr(
        app_module.ingest_mod, "load", lambda path: source_factory()
    )
    monkeypatch.setattr(
        app_module.calibrate_mod,
        "calibrate_image",
        lambda *a, **k: fake_calibration("with-ref"),
    )
    assert client.post("/api/mats/with-ref/reference", files=upload()).status_code == 200

    rows = {row["mat_id"]: row for row in client.get("/api/mats").json()}
    assert rows["with-ref"]["has_reference"] is True
    assert rows["without-ref"]["has_reference"] is False


def test_get_reference_photo_404_when_absent(client):
    save_mat(verified=True)
    response = client.get("/api/mats/letter-7x9-test01/reference")
    assert response.status_code == 404


def test_get_reference_photo_returns_stored_image(client, source_factory, monkeypatch):
    save_mat(verified=True)
    monkeypatch.setattr(
        app_module.ingest_mod, "load", lambda path: source_factory()
    )
    monkeypatch.setattr(
        app_module.calibrate_mod,
        "calibrate_image",
        lambda *a, **k: fake_calibration("letter-7x9-test01"),
    )
    client.post("/api/mats/letter-7x9-test01/reference", files=upload())

    response = client.get("/api/mats/letter-7x9-test01/reference")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert np.frombuffer(response.content, dtype=np.uint8).size > 0
