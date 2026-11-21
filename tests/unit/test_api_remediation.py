"""
Unit and integration tests for ZORBIT Milestone 5.2 FastAPI Remediation and Simulation Router.

Covers:
1. POST /api/v1/simulation/breakup-and-propagate:
   - Successful breakup and propagation with full response schema validation.
   - Invalid request payloads (missing/malformed fields) returning HTTP 422.
   - Domain validation failure (infeasible mass allocation) returning HTTP 422.
   - Unexpected internal exception handling returning HTTP 500 without leaking stack traces.
2. POST /api/v1/remediation/breakup-and-rendezvous:
   - Successful end-to-end breakup, target selection, and CW rendezvous plan.
   - Response schema validation (BreakupRemediationResponse).
   - Invalid request payloads returning HTTP 422.
   - Physical guardrail violations (chaser inside Earth, eccentricity > 0.005) returning HTTP 422.
   - Transfer window exceeding propagation duration returning HTTP 422.
   - Infeasible rendezvous cases (tight delta-v budget, condition number gate) returning HTTP 200 with is_feasible=False.
   - Unexpected internal exception handling returning HTTP 500 without leaking stack traces.
3. System & Route Integrity:
   - Health endpoint (/health) remains HTTP 200 and operational.
   - Conjunction screening and risk assessment routes remain mounted in OpenAPI schema.
   - CORS preflight handling succeeds on both new endpoints for authorized origins.
"""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from simulation import (
    BreakupAndPropagateRequest,
    BreakupAndPropagateResponse,
    BreakupRemediationRequest,
    BreakupRemediationResponse,
    CollisionScenario,
    FragmentationConfig,
    NumericalPropagationConfig,
    ParentBodyState,
    RendezvousConfig,
    TargetingMode,
)
from simulation.constants import MU_EARTH_KM3_S2
from zorbit_api.main import app


# ============================================================================
# Deterministic Test Fixtures (Pure synthetic, zero external network/cache)
# ============================================================================


@pytest.fixture
def test_client() -> TestClient:
    """FastAPI TestClient instance for testing API endpoints."""
    return TestClient(app)


@pytest.fixture
def collision_epoch() -> datetime:
    """Fixed reference collision epoch in UTC."""
    return datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def circular_collision_scenario(collision_epoch: datetime) -> CollisionScenario:
    """Controlled circular collision scenario at r = 7200 km with 5 fragments for fast tests."""
    r0 = 7200.0
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / r0)

    parent_a = ParentBodyState(
        object_id="SAT-ALPHA",
        object_name="Satellite Alpha",
        mass_kg=500.0,
        position_km=(r0, 0.0, 0.0),
        velocity_kms=(0.0, v_circ, 0.001),
    )
    parent_b = ParentBodyState(
        object_id="SAT-BETA",
        object_name="Satellite Beta",
        mass_kg=500.0,
        position_km=(r0, 0.05, 0.0),
        velocity_kms=(0.0, v_circ, -0.001),
    )
    frag_cfg = FragmentationConfig(
        fragment_count=5,
        min_fragment_mass_kg=1.0,
        max_fragment_mass_kg=25.0,
        max_delta_v_kms=0.002,  # 2 m/s ejection bound guarantees 100% CW near-circular compliance
        v_median_kms=0.001,
        seed=42,
    )
    return CollisionScenario(
        collision_epoch=collision_epoch,
        parent_a=parent_a,
        parent_b=parent_b,
        config=frag_cfg,
    )


@pytest.fixture
def valid_breakup_and_propagate_payload(circular_collision_scenario: CollisionScenario) -> dict[str, Any]:
    """JSON-serializable payload for /api/v1/simulation/breakup-and-propagate."""
    req = BreakupAndPropagateRequest(
        scenario=circular_collision_scenario,
        propagation_config=NumericalPropagationConfig(
            duration_seconds=120.0,
            step_seconds=60.0,
        ),
    )
    return req.model_dump(mode="json")


@pytest.fixture
def valid_breakup_and_rendezvous_payload(circular_collision_scenario: CollisionScenario) -> dict[str, Any]:
    """JSON-serializable payload for /api/v1/remediation/breakup-and-rendezvous."""
    epoch = circular_collision_scenario.collision_epoch
    v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)

    req = BreakupRemediationRequest(
        scenario=circular_collision_scenario,
        chaser_id="CHASER-INSPECTOR-1",
        chaser_epoch_utc=epoch,
        chaser_gcrs_position_km=[7200.0, 0.1, 0.0],
        chaser_gcrs_velocity_kms=[0.0, v_circ, 0.0],
        propagation_config=NumericalPropagationConfig(
            duration_seconds=300.0,
            step_seconds=60.0,
        ),
        rendezvous_config=RendezvousConfig(
            transfer_time_s=180.0,
            delta_v_budget_max_ms=500.0,
            targeting_mode=TargetingMode.STANDOFF_HOLD,
            standoff_distance_m=100.0,
        ),
    )
    return req.model_dump(mode="json")


# ============================================================================
# 1. Tests for POST /api/v1/simulation/breakup-and-propagate
# ============================================================================


class TestSimulationBreakupAndPropagateEndpoint:
    """Test suite for the breakup-and-propagate simulation endpoint."""

    def test_breakup_and_propagate_success(
        self, test_client: TestClient, valid_breakup_and_propagate_payload: dict[str, Any]
    ):
        """Verify successful breakup generation and numerical batch propagation."""
        resp = test_client.post(
            "/api/v1/simulation/breakup-and-propagate",
            json=valid_breakup_and_propagate_payload,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()

        # Validate against Pydantic response contract
        validated = BreakupAndPropagateResponse.model_validate(data)
        assert len(validated.fragmentation.fragments) == 5
        assert validated.trajectories.summary.total_fragments == 5
        assert validated.trajectories.summary.completed_count == 5
        assert len(validated.trajectories.trajectories) == 5

        # All generated fragments must be marked synthetic
        for frag in validated.fragmentation.fragments:
            assert frag.is_synthetic is True
            assert frag.fragment_id.startswith("SYNTH-FRAG-")

    def test_breakup_and_propagate_invalid_payload_422(self, test_client: TestClient):
        """Verify that malformed or incomplete payloads return HTTP 422."""
        # Empty payload
        resp = test_client.post("/api/v1/simulation/breakup-and-propagate", json={})
        assert resp.status_code == 422

        # Invalid field types
        resp = test_client.post(
            "/api/v1/simulation/breakup-and-propagate",
            json={"scenario": "not-a-scenario"},
        )
        assert resp.status_code == 422

    def test_breakup_and_propagate_infeasible_mass_allocation_422(
        self, test_client: TestClient, valid_breakup_and_propagate_payload: dict[str, Any]
    ):
        """Verify domain validation error (N * m_min > m_total) maps to HTTP 422."""
        payload = dict(valid_breakup_and_propagate_payload)
        # N=50 fragments with min mass 100 kg -> 5000 kg required, but parents only total 1000 kg
        payload["scenario"]["config"]["fragment_count"] = 50
        payload["scenario"]["config"]["min_fragment_mass_kg"] = 100.0
        payload["scenario"]["config"]["max_fragment_mass_kg"] = 200.0

        resp = test_client.post(
            "/api/v1/simulation/breakup-and-propagate",
            json=payload,
        )
        assert resp.status_code == 422
        assert "Infeasible mass allocation" in resp.json()["detail"]

    def test_breakup_and_propagate_internal_server_error_500(
        self, test_client: TestClient, valid_breakup_and_propagate_payload: dict[str, Any]
    ):
        """Verify unexpected internal exception returns HTTP 500 with a generic detail and no stack trace."""
        with patch(
            "zorbit_api.routers.remediation.simulate_breakup_and_propagate",
            side_effect=RuntimeError("Simulated unexpected numerical crash in C routine"),
        ):
            resp = test_client.post(
                "/api/v1/simulation/breakup-and-propagate",
                json=valid_breakup_and_propagate_payload,
            )
            assert resp.status_code == 500
            assert resp.json()["detail"] == "Internal simulation failure."
            # Confirm internal message not leaked
            assert "Simulated unexpected numerical crash" not in resp.text


# ============================================================================
# 2. Tests for POST /api/v1/remediation/breakup-and-rendezvous
# ============================================================================


class TestRemediationBreakupAndRendezvousEndpoint:
    """Test suite for the breakup-and-rendezvous remediation planning endpoint."""

    def test_breakup_and_rendezvous_success(
        self, test_client: TestClient, valid_breakup_and_rendezvous_payload: dict[str, Any]
    ):
        """Verify successful end-to-end breakup simulation, target selection, and CW rendezvous plan."""
        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json=valid_breakup_and_rendezvous_payload,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()

        # Validate against Pydantic response contract
        validated = BreakupRemediationResponse.model_validate(data)
        assert len(validated.fragmentation.fragments) == 5
        assert validated.trajectories_summary.total_fragments == 5
        assert validated.selected_target.is_synthetic is True
        assert validated.contract.target_is_synthetic is True
        assert validated.contract.chaser_id == "CHASER-INSPECTOR-1"
        assert validated.rendezvous.is_mathematically_solvable is True
        assert validated.execution_wall_time_s >= 0.0
        assert "RESEARCH PROTOTYPE" in validated.scientific_disclaimer

    def test_breakup_and_rendezvous_invalid_payload_422(self, test_client: TestClient):
        """Verify that malformed or incomplete payloads return HTTP 422."""
        # Missing required fields
        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json={"chaser_id": "CHASER-1"},
        )
        assert resp.status_code == 422

        # Invalid vector length (chaser_gcrs_position_km len 2 instead of 3)
        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json={
                "scenario": {},
                "chaser_id": "CHASER-1",
                "chaser_epoch_utc": "2026-11-04T12:00:00Z",
                "chaser_gcrs_position_km": [7000.0, 0.0],
                "chaser_gcrs_velocity_kms": [0.0, 7.5, 0.0],
            },
        )
        assert resp.status_code == 422

    def test_breakup_and_rendezvous_chaser_inside_earth_422(
        self, test_client: TestClient, valid_breakup_and_rendezvous_payload: dict[str, Any]
    ):
        """Verify physical guardrail rejection when chaser position radius is inside Earth (r < 6378.137 km)."""
        payload = dict(valid_breakup_and_rendezvous_payload)
        payload["chaser_gcrs_position_km"] = [5000.0, 0.0, 0.0]  # Inside Earth

        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json=payload,
        )
        assert resp.status_code == 422
        assert "inside Earth radius" in str(resp.json()["detail"])

    def test_breakup_and_rendezvous_chaser_eccentricity_violation_422(
        self, test_client: TestClient, valid_breakup_and_rendezvous_payload: dict[str, Any]
    ):
        """Verify physical guardrail rejection when chaser eccentricity exceeds CW near-circular limit (e > 0.005)."""
        payload = dict(valid_breakup_and_rendezvous_payload)
        v_circ = math.sqrt(MU_EARTH_KM3_S2 / 7200.0)
        # 1.05 * v_circ yields an eccentric orbit e > 0.05 >> 0.005
        payload["chaser_gcrs_velocity_kms"] = [0.0, v_circ * 1.05, 0.0]

        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json=payload,
        )
        assert resp.status_code == 422
        assert "exceeds near-circular limit" in str(resp.json()["detail"])

    def test_breakup_and_rendezvous_transfer_longer_than_propagation_422(
        self, test_client: TestClient, valid_breakup_and_rendezvous_payload: dict[str, Any]
    ):
        """Verify validation rejection when transfer duration exceeds numerical propagation duration."""
        payload = dict(valid_breakup_and_rendezvous_payload)
        payload["rendezvous_config"]["transfer_time_s"] = 1200.0  # 1200s transfer
        payload["propagation_config"]["duration_seconds"] = 300.0  # Only 300s propagated

        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json=payload,
        )
        assert resp.status_code == 422
        assert "extends beyond propagation duration" in str(resp.json()["detail"])

    def test_breakup_and_rendezvous_infeasible_budget(
        self, test_client: TestClient, valid_breakup_and_rendezvous_payload: dict[str, Any]
    ):
        """Verify that an infeasible delta-v budget returns HTTP 200 with is_feasible=False."""
        payload = dict(valid_breakup_and_rendezvous_payload)
        # Extremely small budget (0.001 m/s) forces budget infeasibility
        payload["rendezvous_config"]["delta_v_budget_max_ms"] = 0.001

        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json=payload,
        )
        assert resp.status_code == 200
        data = resp.json()
        validated = BreakupRemediationResponse.model_validate(data)
        assert validated.rendezvous.is_mathematically_solvable is True
        assert validated.rendezvous.is_budget_feasible is False
        assert validated.rendezvous.is_feasible is False

    def test_breakup_and_rendezvous_singular_condition_gate_infeasible(
        self, test_client: TestClient, valid_breakup_and_rendezvous_payload: dict[str, Any]
    ):
        """Verify that an ill-conditioned transfer matrix returns HTTP 200 with is_mathematically_solvable=False."""
        payload = dict(valid_breakup_and_rendezvous_payload)
        # Setting max_condition_number = 1.01 (gt=1.0) triggers condition gate failure (actual kappa ~ 1.017)
        payload["rendezvous_config"]["max_condition_number"] = 1.01

        resp = test_client.post(
            "/api/v1/remediation/breakup-and-rendezvous",
            json=payload,
        )
        assert resp.status_code == 200
        data = resp.json()
        validated = BreakupRemediationResponse.model_validate(data)
        assert validated.rendezvous.is_mathematically_solvable is False
        assert validated.rendezvous.is_feasible is False

    def test_breakup_and_rendezvous_internal_server_error_500(
        self, test_client: TestClient, valid_breakup_and_rendezvous_payload: dict[str, Any]
    ):
        """Verify unexpected internal exception returns HTTP 500 with generic detail and no stack trace."""
        with patch(
            "zorbit_api.routers.remediation.plan_breakup_remediation",
            side_effect=RuntimeError("Simulated internal solver crash"),
        ):
            resp = test_client.post(
                "/api/v1/remediation/breakup-and-rendezvous",
                json=valid_breakup_and_rendezvous_payload,
            )
            assert resp.status_code == 500
            assert resp.json()["detail"] == "Internal simulation failure."
            assert "Simulated internal solver crash" not in resp.text


# ============================================================================
# 3. Tests for Existing API Routes & CORS Integrity
# ============================================================================


class TestAPIRouteAndCORSIntegrity:
    """Verify that adding the remediation router preserved existing endpoints and CORS."""

    def test_health_endpoint_intact(self, test_client: TestClient):
        """Verify GET /health returns 200 healthy."""
        resp = test_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["service"] == "zorbit_api"
        assert "offline_mode" in data

    def test_all_expected_routes_registered_in_openapi(self):
        """Verify that all existing and new routes are registered in OpenAPI schema."""
        openapi_paths = app.openapi()["paths"]
        expected_routes = [
            "/health",
            "/api/v1/conjunctions/screen",
            "/api/v1/risk/assess",
            "/api/v1/risk/assess-batch",
            "/api/v1/simulation/breakup-and-propagate",
            "/api/v1/remediation/breakup-and-rendezvous",
        ]
        for route in expected_routes:
            assert route in openapi_paths, f"Missing route in OpenAPI paths: {route}"

    def test_cors_preflight_on_simulation_endpoint(self, test_client: TestClient):
        """Verify CORS preflight succeeds on POST /api/v1/simulation/breakup-and-propagate."""
        resp = test_client.options(
            "/api/v1/simulation/breakup-and-propagate",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"

    def test_cors_preflight_on_remediation_endpoint(self, test_client: TestClient):
        """Verify CORS preflight succeeds on POST /api/v1/remediation/breakup-and-rendezvous."""
        resp = test_client.options(
            "/api/v1/remediation/breakup-and-rendezvous",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
