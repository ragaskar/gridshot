"""Unhandled exceptions surface their real error text instead of a bare 500.

Routes that anticipate specific failures already raise HTTPException with a
useful detail (see /api/trace's NoToolFoundError/RuntimeError/ValueError
handling). This covers what happens for everything else: a bug or an
exception type nobody anticipated.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gridshot.server import app as app_module


@pytest.fixture
def client():
    # ServerErrorMiddleware re-raises after invoking our handler so ASGI
    # servers still log it; raise_server_exceptions=False stops the test
    # client from propagating that and lets us inspect the response that
    # was actually sent to the browser.
    return TestClient(app_module.app, raise_server_exceptions=False)


def test_generic_unhandled_exception_returns_error_text(client):
    @app_module.app.get("/api/_test/boom")
    def _boom():
        raise KeyError("mystery_key")

    # A route added via decorator lands at the end of app.router.routes. If
    # the SPA catch-all (`/{full_path:path}`, matched for any /api/ path it
    # doesn't recognize — see spa_fallback) is already mounted, it's earlier
    # in that list and would shadow this newly added route. Move ours to the
    # front so the test exercises this route regardless of route order.
    app_module.app.router.routes.insert(0, app_module.app.router.routes.pop())

    response = client.get("/api/_test/boom")

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert detail != "Internal Server Error"
    assert "KeyError" in detail
    assert "mystery_key" in detail


def test_trace_unexpected_exception_surfaces_detail(monkeypatch, tmp_path, client):
    monkeypatch.setattr(app_module, "PROJECTS", tmp_path)

    def _boom(*args, **kwargs):
        raise TypeError("thickness must be a float, got a duck")

    monkeypatch.setattr(app_module.trace_mod, "run", _boom)

    response = client.post(
        "/api/trace",
        files={"file": ("tool.jpg", b"not-really-an-image", "image/jpeg")},
        data={"thickness": "10"},
    )

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert detail != "Internal Server Error"
    assert "TypeError" in detail
    assert "thickness must be a float, got a duck" in detail
