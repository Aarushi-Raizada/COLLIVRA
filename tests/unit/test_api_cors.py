"""
Unit tests verifying CORS configuration and preflight handling in ZORBIT API.
"""

from fastapi.testclient import TestClient
from zorbit_api.main import app


def test_cors_preflight_localhost_3000():
    """Verify that OPTIONS /health preflight from http://localhost:3000 succeeds."""
    with TestClient(app) as client:
        resp = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
        assert "GET" in resp.headers.get("access-control-allow-methods", "")
        assert "content-type" in resp.headers.get("access-control-allow-headers", "").lower()


def test_cors_preflight_127_0_0_1_3000():
    """Verify that OPTIONS /health preflight from http://127.0.0.1:3000 succeeds."""
    with TestClient(app) as client:
        resp = client.options(
            "/health",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:3000"


def test_cors_preflight_unauthorized_origin():
    """Verify that OPTIONS /health preflight from unauthorized origin is rejected."""
    with TestClient(app) as client:
        resp = client.options(
            "/health",
            headers={
                "Origin": "http://unauthorized-domain.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        # CORSMiddleware returns 400 Disallowed CORS origin
        assert resp.status_code == 400
        assert "access-control-allow-origin" not in resp.headers


def test_cors_get_health_with_origin():
    """Verify that actual GET /health from http://localhost:3000 includes CORS headers."""
    with TestClient(app) as client:
        resp = client.get(
            "/health",
            headers={"Origin": "http://localhost:3000"},
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
        assert resp.json().get("status") == "healthy"

