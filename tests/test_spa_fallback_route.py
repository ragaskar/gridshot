"""Deep links use durable path segments (/library, /editor/<id>, ...) rather
than query params, so a full reload has to resolve them server-side too:
StaticFiles(html=True) only serves index.html for "/" itself, not for an
arbitrary unmatched path, so reloading e.g. /library used to 404. spa_fallback
is the catch-all that fixes that — see docs/deep-link-urls.md.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from gridshot.server import app as app_module


@pytest.fixture
def dist(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>spa shell</html>")
    (tmp_path / "favicon.ico").write_bytes(b"\x00")
    monkeypatch.setattr(app_module, "WEB_DIST", tmp_path)
    return tmp_path


def test_unmatched_path_falls_back_to_index_html_no_cache(dist):
    response = app_module.spa_fallback("library")

    assert response.path == dist / "index.html"
    assert response.headers["cache-control"] == "no-cache, must-revalidate"


def test_root_falls_back_to_index_html(dist):
    response = app_module.spa_fallback("")

    assert response.path == dist / "index.html"


def test_dynamic_segment_path_falls_back_to_index_html(dist):
    response = app_module.spa_fallback("editor/abc123")

    assert response.path == dist / "index.html"


def test_nested_combine_path_falls_back_to_index_html(dist):
    response = app_module.spa_fallback("library/combine/id1,id2")

    assert response.path == dist / "index.html"


def test_real_static_file_is_served_directly(dist):
    response = app_module.spa_fallback("favicon.ico")

    assert response.path == dist / "favicon.ico"


def test_path_traversal_falls_back_to_index_html_instead_of_escaping(dist, tmp_path):
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("do not serve me")

    response = app_module.spa_fallback("../secret.txt")

    assert response.path == dist / "index.html"


def test_immutable_assets_sets_long_cache_header(tmp_path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index-abc123.js").write_text("console.log('hi')")
    test_app = FastAPI()
    test_app.mount("/assets", app_module._ImmutableAssets(directory=assets), name="assets")

    response = TestClient(test_app).get("/assets/index-abc123.js")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.skipif(
    not app_module.WEB_DIST.is_dir(),
    reason="exercises the real route wiring, which needs a web/dist build (npm run build)",
)
def test_client_side_route_reload_serves_spa_shell_not_404():
    response = TestClient(app_module.app).get("/library")

    assert response.status_code == 200
    assert (app_module.WEB_DIST / "index.html").read_text() == response.text
