"""
HTTP integration tests for Earth Orientation (IERS) Policy and Quality Reporting in ZORBIT API.

Covers AST-01B requirements:
1. Health endpoint exposes iers_mode and offline_mode.
2. EarthOrientationPolicyError is mapped to HTTP 422 Unprocessable Content with structured body:
   - code: "EARTH_ORIENTATION_POLICY_VIOLATION"
   - detail: useful explanation
   - epoch: ISO timestamp string
   - data_source: string identifier
   - details: dictionary
3. POST /api/v1/conjunctions/screen under default OFFLINE_PREDICTIVE mode returns HTTP 200 with
   valid, un-fabricated EarthOrientationQuality metadata in summary.earth_orientation and
   response.earth_orientation.
4. POST /api/v1/conjunctions/screen under OFFLINE_STRICT mode raises EarthOrientationPolicyError
   and maps to HTTP 422 when screening window uses a stale or out-of-range epoch.
5. POST /api/v1/conjunctions/screen with TEME target frame skips EOP transformation and leaves
   earth_orientation as None.
6. Standard input validation (e.g. invalid time range) continues to return standard Pydantic 422.
"""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from zorbit_api.main import app


@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient instance with application lifespan."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def sample_conjunction_payload(stations_fixture: list[dict]) -> dict:
    """Construct a minimal valid 2-satellite conjunction screening payload."""
    iss = stations_fixture[0]
    css = stations_fixture[1]

    # Reference epoch from ISS fixture, explicitly UTC timezone-aware
    raw_epoch = datetime.fromisoformat(iss["EPOCH"])
    if raw_epoch.tzinfo is None:
        start_dt = raw_epoch.replace(tzinfo=timezone.utc)
    else:
        start_dt = raw_epoch
    end_dt = start_dt + timedelta(minutes=15)

    return {
        "objects": [iss, css],
        "start_time": start_dt.isoformat(),
        "end_time": end_dt.isoformat(),
        "step_seconds": 60.0,
        "threshold_km": 50.0,
        "target_frame": "GCRS",
    }


class TestHealthEndpointIERSMetadata:
    """Verify health endpoint reports IERS operational configuration."""

    def test_health_reports_iers_mode(self, client: TestClient, monkeypatch):
        """Verify GET /health reports status, offline_mode, and iers_mode."""
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["service"] == "zorbit_api"
        assert data["offline_mode"] is True
        assert data["iers_mode"] == "OFFLINE_PREDICTIVE"

    def test_health_reports_strict_mode(self, client: TestClient, monkeypatch):
        """Verify GET /health reports OFFLINE_STRICT when configured."""
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_STRICT")
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["iers_mode"] == "OFFLINE_STRICT"


class TestConjunctionScreeningQualityMetadata:
    """Verify EarthOrientationQuality metadata reporting in screening responses."""

    def test_screen_returns_quality_metadata_predictive_mode(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """
        Verify that POST /api/v1/conjunctions/screen attaches valid EarthOrientationQuality
        metadata in both summary.earth_orientation and response.earth_orientation.
        """
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        resp = client.post("/api/v1/conjunctions/screen", json=sample_conjunction_payload)
        assert resp.status_code == 200
        data = resp.json()

        assert "summary" in data
        assert "earth_orientation" in data["summary"]
        assert "earth_orientation" in data

        eo_summary = data["summary"]["earth_orientation"]
        eo_resp = data["earth_orientation"]

        assert eo_summary is not None
        assert eo_resp is not None
        assert eo_summary == eo_resp

        # Check fields match EarthOrientationQuality schema
        assert "data_source" in eo_summary
        assert "is_degraded" in eo_summary
        assert "provenance_tier" in eo_summary
        assert "prediction_horizon_days" in eo_summary
        assert "ut1_status" in eo_summary
        assert "pm_status" in eo_summary
        assert "earth_orientation_disclaimer" in eo_summary

        # Fixture epoch is November 2026, which is within Bulletin A predictions
        assert eo_summary["provenance_tier"] in ("FORWARD_PREDICTION", "UNMAINTAINED_PREDICTION")
        assert isinstance(eo_summary["is_degraded"], bool)

    def test_screen_teme_target_frame_leaves_quality_none(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """
        Verify that when target_frame is TEME, no Earth orientation transformation occurs,
        so earth_orientation metadata is not populated (None).
        """
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["target_frame"] = "TEME"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        assert data["summary"]["target_frame"] == "TEME"
        assert data["summary"]["earth_orientation"] is None
        assert data["earth_orientation"] is None


class TestEarthOrientationPolicyExceptionMapping:
    """Verify HTTP 422 mapping when EarthOrientationPolicyError is raised."""

    def test_strict_mode_rejects_out_of_range_epoch(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """
        In OFFLINE_STRICT mode, querying an out-of-range epoch (e.g. year 2030) must raise
        EarthOrientationPolicyError and be mapped to HTTP 422 with structured rejection format.
        """
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_STRICT")

        payload = copy.deepcopy(sample_conjunction_payload)
        payload["start_time"] = "2030-01-01T00:00:00Z"
        payload["end_time"] = "2030-01-01T00:15:00Z"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 422
        body = resp.json()

        assert body["code"] == "EARTH_ORIENTATION_POLICY_VIOLATION"
        assert "rejected under OFFLINE_STRICT policy" in body["detail"]
        assert body["epoch"] is not None
        assert "2030-01-01" in body["epoch"]
        assert body["data_source"] == "OUT_OF_RANGE"
        assert body["details"]["provenance_tier"] == "BOUNDARY_FALLBACK"
        assert body["details"]["mode"] == "OFFLINE_STRICT"

    def test_unrelated_validation_error_preserves_standard_422(
        self, client: TestClient, sample_conjunction_payload: dict
    ):
        """
        Verify that unrelated input validation failures (e.g. missing required field or
        end_time < start_time) still return standard FastAPI/Pydantic 422 responses.
        """
        payload = copy.deepcopy(sample_conjunction_payload)
        # Inverted time range violates Pydantic model validator
        payload["start_time"] = "2026-11-01T12:00:00Z"
        payload["end_time"] = "2026-11-01T11:00:00Z"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        # Standard FastAPI validation error has 'detail' as a list of error dicts
        assert isinstance(body.get("detail"), list)
        assert any("end_time" in str(err) for err in body["detail"])


class TestConjunctionIntervalEarthOrientationQuality:
    """
    Focused verification tests for AST-01B.2 conjunction interval Earth-orientation quality.

    Validates that:
    1. Intervals entirely inside definitive data report DEFINITIVE.
    2. Intervals entirely inside fresh predictive data report PREDICTIVE_FRESH.
    3. Intervals starting fresh and ending stale report PREDICTIVE_STALE.
    4. Intervals crossing the exact fresh-to-stale boundary (MJD 61351.0) report PREDICTIVE_STALE.
    5. In strict mode, intervals with valid start but stale/out-of-range end are rejected (HTTP 422).
    6. Strict-mode rejection occurs before conjunction propagation execution.
    7. Quality metadata is consistent in summary.earth_orientation and response.earth_orientation.
    8. TEME requests bypass Earth orientation validation and leave metadata as None.
    9. Inverted intervals continue to fail fast via Pydantic model validation.
    10. Unrelated validation exceptions retain standard response formats.
    """

    def test_interval_entirely_inside_definitive_period(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """Interval entirely within IERS-B definitive observations must report DEFINITIVE."""
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["start_time"] = "2026-06-01T00:00:00Z"
        payload["end_time"] = "2026-06-01T01:00:00Z"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        eo = data["summary"]["earth_orientation"]
        assert eo is not None
        assert eo["data_source"] == "DEFINITIVE"
        assert eo["provenance_tier"] == "OBSERVED_EOP"
        assert eo["is_degraded"] is False
        assert data["earth_orientation"] == eo

    def test_interval_entirely_inside_fresh_predictive_period(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """Interval entirely within fresh prediction horizon (<=30d from MJD 61321.0) reports PREDICTIVE_FRESH."""
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        payload = copy.deepcopy(sample_conjunction_payload)
        # MJD 61328 is 2026-10-15 (7 days after definitive MJD 61321.0)
        payload["start_time"] = "2026-10-15T00:00:00Z"
        payload["end_time"] = "2026-10-15T02:00:00Z"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        eo = data["summary"]["earth_orientation"]
        assert eo is not None
        assert eo["data_source"] == "PREDICTIVE_FRESH"
        assert eo["provenance_tier"] == "FORWARD_PREDICTION"
        assert eo["is_degraded"] is False
        assert data["earth_orientation"] == eo

    def test_interval_fresh_to_stale_predictive_period(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """Interval beginning in fresh predictive and ending in stale predictive must report PREDICTIVE_STALE."""
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        payload = copy.deepcopy(sample_conjunction_payload)
        # Threshold is MJD 61351.0 (2026-11-07 00:00:00 UTC).
        # Start: 2026-11-06 23:45:00 UTC (horizon ~29.99d <= 30d, fresh)
        # End:   2026-11-07 00:15:00 UTC (horizon ~30.01d > 30d, stale)
        payload["start_time"] = "2026-11-06T23:45:00Z"
        payload["end_time"] = "2026-11-07T00:15:00Z"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 200
        data = resp.json()

        eo = data["summary"]["earth_orientation"]
        assert eo is not None
        assert eo["data_source"] == "PREDICTIVE_STALE"
        assert eo["provenance_tier"] == "UNMAINTAINED_PREDICTION"
        assert eo["is_degraded"] is True
        assert data["earth_orientation"] == eo

    def test_interval_crossing_exact_fresh_stale_boundary(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """
        Interval crossing the exact boundary (MJD 61351.0 = 2026-11-07 00:00:00 UTC).
        Under OFFLINE_PREDICTIVE: reports degraded PREDICTIVE_STALE.
        Under OFFLINE_STRICT: returns HTTP 422 rejected on end epoch.
        """
        # Exact threshold: 2026-11-07 00:00:00 UTC
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["start_time"] = "2026-11-06T23:55:00Z"  # 5 min before threshold (fresh)
        payload["end_time"] = "2026-11-07T00:05:00Z"    # 5 min after threshold (stale)

        # 1. Predictive mode
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        resp_pred = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp_pred.status_code == 200
        eo = resp_pred.json()["summary"]["earth_orientation"]
        assert eo["data_source"] == "PREDICTIVE_STALE"
        assert eo["is_degraded"] is True

        # 2. Strict mode
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_STRICT")
        resp_strict = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp_strict.status_code == 422
        body = resp_strict.json()
        assert body["code"] == "EARTH_ORIENTATION_POLICY_VIOLATION"
        assert "2026-11-07" in body["epoch"]
        assert body["data_source"] == "PREDICTIVE_STALE"

    def test_interval_valid_start_but_end_outside_strict_coverage(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """
        In OFFLINE_STRICT mode, an interval whose start_time is valid fresh predictive data
        but end_time is outside permitted table coverage must be rejected with HTTP 422.
        """
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_STRICT")
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["start_time"] = "2026-10-15T00:00:00Z"  # Valid fresh prediction
        payload["end_time"] = "2030-01-01T00:15:00Z"    # Out of range

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert body["code"] == "EARTH_ORIENTATION_POLICY_VIOLATION"
        assert "2030-01-01" in body["epoch"]
        assert body["data_source"] == "OUT_OF_RANGE"

    def test_strict_violation_blocks_propagation_before_execution(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """
        Verify that in OFFLINE_STRICT mode, when end_time is degraded,
        screen_conjunctions is NEVER invoked.
        """
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_STRICT")
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["start_time"] = "2026-10-15T00:00:00Z"
        payload["end_time"] = "2026-11-20T00:00:00Z"  # Stale

        with patch("zorbit_api.routers.conjunctions.screen_conjunctions") as mock_screen:
            resp = client.post("/api/v1/conjunctions/screen", json=payload)
            assert resp.status_code == 422
            mock_screen.assert_not_called()

    def test_consistent_quality_metadata_in_both_response_locations(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """Verify summary.earth_orientation and response.earth_orientation are identical."""
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE")
        resp = client.post("/api/v1/conjunctions/screen", json=sample_conjunction_payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary"]["earth_orientation"] == data["earth_orientation"]

    def test_teme_skips_interval_eop_evaluation(
        self, client: TestClient, sample_conjunction_payload: dict, monkeypatch
    ):
        """
        When target_frame is TEME, Earth orientation parameter validation is completely
        bypassed: even with future/stale dates in OFFLINE_STRICT mode, screening succeeds
        and returns None for Earth orientation metadata.
        """
        monkeypatch.setenv("ZORBIT_IERS_MODE", "OFFLINE_STRICT")
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["target_frame"] = "TEME"
        # 15 minute window in year 2030
        payload["start_time"] = "2030-01-01T00:00:00Z"
        payload["end_time"] = "2030-01-01T00:15:00Z"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary"]["target_frame"] == "TEME"
        assert data["summary"]["earth_orientation"] is None
        assert data["earth_orientation"] is None

    def test_inverted_interval_validation(
        self, client: TestClient, sample_conjunction_payload: dict
    ):
        """Verify inverted time intervals fail Pydantic model validation with HTTP 422."""
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["start_time"] = "2026-11-05T00:00:00Z"
        payload["end_time"] = "2026-11-01T00:00:00Z"

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert isinstance(body.get("detail"), list)
        assert any("end_time" in str(err) for err in body["detail"])

    def test_unrelated_validation_error_preserves_standard_422(
        self, client: TestClient, sample_conjunction_payload: dict
    ):
        """Verify non-finite or negative step_seconds fails with standard Pydantic 422."""
        payload = copy.deepcopy(sample_conjunction_payload)
        payload["step_seconds"] = -10.0

        resp = client.post("/api/v1/conjunctions/screen", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert isinstance(body.get("detail"), list)
        assert any("step_seconds" in str(err) for err in body["detail"])
