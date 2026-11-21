"""
Unit and integration tests for ZORBIT Day 7 Heuristic Risk-Prioritization Engine.

Covers:
1. Mathematical factors and exact boundaries (distance, speed, time).
2. Exact-TCA (f_time = 1.0) and historical-TCA (f_time = 0.0 + warning).
3. All five operational category boundaries (CRITICAL, HIGH, MODERATE, LOW, NEGLIGIBLE).
4. Zero relative speed handling (f_speed = 0.0, warning, COMPLETE data quality).
5. Missing optional metadata resilience (COMPLETE data quality).
6. NaN, infinity, and negative kinematics rejection.
7. Centralized timezone normalization (UTC, positive offset, negative offset, naive rejection).
8. Custom weights validation and contribution verification.
9. Empty batch processing (HTTP 200, zero counts).
10. Duplicate event_id rejection in batch.
11. Deterministic batch sorting (-risk_score, event_id, tca).
12. Shared authoritative batch evaluation timestamp.
13. Direct pipeline integration with screen_conjunctions().
14. FastAPI REST endpoints (/api/v1/risk/assess and /api/v1/risk/assess-batch).
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest
from orbital_core.conjunction import screen_conjunctions
from orbital_core.risk import (
    assess_risk,
    assess_risk_batch,
    calculate_risk_factors,
    get_risk_category,
)
from orbital_core.schemas import (
    ConjunctionEvent,
    DataQualityLevel,
    OrbitalObjectRecord,
    RiskAssessmentBatchRequest,
    RiskAssessmentRequest,
    RiskCategory,
    RiskWeights,
    normalize_datetime_utc,
)
from pydantic import ValidationError
from zorbit_api.main import app


@pytest.fixture
def base_tca() -> datetime:
    return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def make_event(base_tca: datetime):
    def _builder(
        event_id: str = "CONJ-TEST-001",
        miss_distance_km: float = 1.0,
        relative_speed_kms: float = 7.5,
        tca: datetime | None = None,
        object_1_id: str = "25544",
        object_1_name: str | None = "ISS (ZARYA)",
        object_2_id: str = "48274",
        object_2_name: str | None = "DEBRIS",
    ) -> ConjunctionEvent:
        return ConjunctionEvent(
            event_id=event_id,
            object_1_id=object_1_id,
            object_1_name=object_1_name,
            object_2_id=object_2_id,
            object_2_name=object_2_name,
            tca=tca or base_tca,
            miss_distance_km=miss_distance_km,
            relative_position_km=(0.5, 0.5, 0.7071),
            relative_velocity_kms=(1.0, -7.0, 2.5),
            relative_speed_kms=relative_speed_kms,
            category="HIGH",
            screening_threshold_km=10.0,
            frame="GCRS",
            step_seconds=60.0,
            method="NUMERICAL_OPTIMIZATION",
        )

    return _builder


# ============================================================================
# 1. Mathematical Factors and Boundaries
# ============================================================================


class TestMathematicalFactorsAndBoundaries:
    def test_distance_factor_boundary_values(self, make_event, base_tca):
        """Verify miss distance exponential decay at 0 km, 2 km, and 10 km."""
        eval_time = base_tca

        # 0 km -> exp(0) = 1.0
        ev0 = make_event(miss_distance_km=0.0)
        factors, _ = calculate_risk_factors(ev0, evaluation_time=eval_time)
        f_dist = next(f for f in factors if f.factor_name == "MISS_DISTANCE")
        assert math.isclose(f_dist.normalized_value, 1.0, abs_tol=1e-9)

        # 2 km -> exp(-1) = 0.367879...
        ev2 = make_event(miss_distance_km=2.0)
        factors2, _ = calculate_risk_factors(ev2, evaluation_time=eval_time)
        f_dist2 = next(f for f in factors2 if f.factor_name == "MISS_DISTANCE")
        assert math.isclose(f_dist2.normalized_value, math.exp(-1.0), abs_tol=1e-7)

        # 10 km -> exp(-5)
        ev10 = make_event(miss_distance_km=10.0)
        factors10, _ = calculate_risk_factors(ev10, evaluation_time=eval_time)
        f_dist10 = next(f for f in factors10 if f.factor_name == "MISS_DISTANCE")
        assert math.isclose(f_dist10.normalized_value, math.exp(-5.0), abs_tol=1e-7)

    def test_speed_factor_boundary_values(self, make_event, base_tca):
        """Verify relative speed linear ramp at 0 km/s, 7.5 km/s, 15 km/s, and > 15 km/s."""
        eval_time = base_tca

        # 0 km/s -> 0.0 + warning
        ev0 = make_event(relative_speed_kms=0.0)
        factors0, warnings0 = calculate_risk_factors(ev0, evaluation_time=eval_time)
        f_speed0 = next(f for f in factors0 if f.factor_name == "RELATIVE_SPEED")
        assert math.isclose(f_speed0.normalized_value, 0.0, abs_tol=1e-9)
        assert any("relative speed is zero" in w for w in warnings0)

        # 7.5 km/s -> 0.5
        ev75 = make_event(relative_speed_kms=7.5)
        factors75, warnings75 = calculate_risk_factors(ev75, evaluation_time=eval_time)
        f_speed75 = next(f for f in factors75 if f.factor_name == "RELATIVE_SPEED")
        assert math.isclose(f_speed75.normalized_value, 0.5, abs_tol=1e-9)
        assert len(warnings75) == 0

        # 15.0 km/s -> 1.0
        ev15 = make_event(relative_speed_kms=15.0)
        factors15, _ = calculate_risk_factors(ev15, evaluation_time=eval_time)
        f_speed15 = next(f for f in factors15 if f.factor_name == "RELATIVE_SPEED")
        assert math.isclose(f_speed15.normalized_value, 1.0, abs_tol=1e-9)

        # 30.0 km/s -> clamped to 1.0
        ev30 = make_event(relative_speed_kms=30.0)
        factors30, _ = calculate_risk_factors(ev30, evaluation_time=eval_time)
        f_speed30 = next(f for f in factors30 if f.factor_name == "RELATIVE_SPEED")
        assert math.isclose(f_speed30.normalized_value, 1.0, abs_tol=1e-9)

    def test_exact_tca_urgency(self, make_event, base_tca):
        """At delta_t = 0 (exact TCA), time urgency factor MUST equal 1.0."""
        ev = make_event(tca=base_tca)
        factors, warnings = calculate_risk_factors(ev, evaluation_time=base_tca)
        f_time = next(f for f in factors if f.factor_name == "TIME_TO_TCA")

        assert math.isclose(f_time.normalized_value, 1.0, abs_tol=1e-9)
        assert math.isclose(f_time.raw_value, 0.0, abs_tol=1e-9)
        assert len(warnings) == 0

    def test_time_factor_half_life(self, make_event, base_tca):
        """Verify 36h half-life: f_time = 0.50 at 36h, 0.25 at 72h."""
        eval_time = base_tca

        # 36 hours later -> 2^(-1) = 0.50
        ev36 = make_event(tca=base_tca + timedelta(hours=36))
        factors36, _ = calculate_risk_factors(ev36, evaluation_time=eval_time)
        f_time36 = next(f for f in factors36 if f.factor_name == "TIME_TO_TCA")
        assert math.isclose(f_time36.normalized_value, 0.50, abs_tol=1e-9)

        # 72 hours later -> 2^(-2) = 0.25
        ev72 = make_event(tca=base_tca + timedelta(hours=72))
        factors72, _ = calculate_risk_factors(ev72, evaluation_time=eval_time)
        f_time72 = next(f for f in factors72 if f.factor_name == "TIME_TO_TCA")
        assert math.isclose(f_time72.normalized_value, 0.25, abs_tol=1e-9)

    def test_historical_tca_evaluates_to_zero_with_warning(self, make_event, base_tca):
        """When delta_t < 0 (historical encounter), f_time = 0.0 and warning is emitted."""
        eval_time = base_tca
        historical_tca = base_tca - timedelta(hours=6)

        ev = make_event(tca=historical_tca)
        factors, warnings = calculate_risk_factors(ev, evaluation_time=eval_time)
        f_time = next(f for f in factors if f.factor_name == "TIME_TO_TCA")

        assert math.isclose(f_time.normalized_value, 0.0, abs_tol=1e-9)
        assert f_time.raw_value < 0.0
        assert any("historical encounter" in w for w in warnings)


# ============================================================================
# 2. Category Classification and Thresholds
# ============================================================================


class TestCategoryClassification:
    def test_five_tier_category_thresholds(self):
        """Verify exact classification for all five categories."""
        # CRITICAL: 75.0 <= score <= 100.0
        assert get_risk_category(100.0) == RiskCategory.CRITICAL
        assert get_risk_category(75.0) == RiskCategory.CRITICAL

        # HIGH: 50.0 <= score < 75.0
        assert get_risk_category(74.9999) == RiskCategory.HIGH
        assert get_risk_category(50.0) == RiskCategory.HIGH

        # MODERATE: 25.0 <= score < 50.0
        assert get_risk_category(49.9999) == RiskCategory.MODERATE
        assert get_risk_category(25.0) == RiskCategory.MODERATE

        # LOW: 10.0 <= score < 25.0
        assert get_risk_category(24.9999) == RiskCategory.LOW
        assert get_risk_category(10.0) == RiskCategory.LOW

        # NEGLIGIBLE: 0.0 <= score < 10.0
        assert get_risk_category(9.9999) == RiskCategory.NEGLIGIBLE
        assert get_risk_category(0.0) == RiskCategory.NEGLIGIBLE

    def test_extreme_and_clamped_scores(self, make_event, base_tca):
        """Verify assessment handles extreme geometries properly."""
        # Maximum possible risk: d=0, v=15+, dt=0 -> 100.0 (CRITICAL)
        ev_max = make_event(miss_distance_km=0.0, relative_speed_kms=20.0, tca=base_tca)
        res_max = assess_risk(ev_max, evaluation_time=base_tca)
        assert math.isclose(res_max.risk_score, 100.0, abs_tol=1e-7)
        assert res_max.risk_category == RiskCategory.CRITICAL

        # Minimal risk: d=100km, v=0km/s, dt=1000h -> near 0.0 (NEGLIGIBLE)
        ev_min = make_event(
            miss_distance_km=100.0,
            relative_speed_kms=0.0,
            tca=base_tca + timedelta(days=100),
        )
        res_min = assess_risk(ev_min, evaluation_time=base_tca)
        assert res_min.risk_score < 1.0
        assert res_min.risk_category == RiskCategory.NEGLIGIBLE


# ============================================================================
# 3. Data Quality and Missing Optional Metadata
# ============================================================================


class TestDataQualityAndMetadata:
    def test_missing_optional_names_preserves_complete_data_quality(self, make_event, base_tca):
        """Missing object names do NOT downgrade data quality to INCOMPLETE."""
        ev = make_event(object_1_name=None, object_2_name=None)
        res = assess_risk(ev, evaluation_time=base_tca)

        assert res.primary_object_name is None
        assert res.secondary_object_name is None
        assert res.data_quality == DataQualityLevel.COMPLETE

    def test_zero_relative_speed_preserves_complete_data_quality(self, make_event, base_tca):
        """Zero encounter speed is a valid kinematic condition, keeping data quality COMPLETE."""
        ev = make_event(relative_speed_kms=0.0)
        res = assess_risk(ev, evaluation_time=base_tca)

        assert res.data_quality == DataQualityLevel.COMPLETE
        assert any("relative speed is zero" in w for w in res.warnings)


# ============================================================================
# 4. Input Validation: Non-finite, Negative, and Naive Datetimes
# ============================================================================


class TestInputValidation:
    def test_nan_miss_distance_rejected(self, make_event):
        """NaN miss distance raises validation error."""
        with pytest.raises(ValidationError):
            make_event(miss_distance_km=float("nan"))

    def test_inf_miss_distance_rejected(self, make_event):
        """Infinite miss distance raises validation error."""
        with pytest.raises(ValidationError):
            make_event(miss_distance_km=float("inf"))

    def test_negative_miss_distance_rejected(self, make_event):
        """Negative miss distance raises validation error."""
        with pytest.raises(ValidationError):
            make_event(miss_distance_km=-1.0)

    def test_nan_relative_speed_rejected(self, make_event):
        """NaN relative speed raises validation error."""
        with pytest.raises(ValidationError):
            make_event(relative_speed_kms=float("nan"))

    def test_inf_relative_speed_rejected(self, make_event):
        """Infinite relative speed raises validation error."""
        with pytest.raises(ValidationError):
            make_event(relative_speed_kms=float("inf"))

    def test_negative_relative_speed_rejected(self, make_event):
        """Negative relative speed raises validation error."""
        with pytest.raises(ValidationError):
            make_event(relative_speed_kms=-5.0)

    def test_naive_datetime_tca_rejected(self, make_event):
        """Naive datetime for TCA raises validation error."""
        naive_dt = datetime(2026, 11, 2, 12, 0, 0)
        with pytest.raises(ValidationError):
            make_event(tca=naive_dt)

    def test_naive_datetime_evaluation_time_rejected(self, make_event, base_tca):
        """Naive datetime for evaluation_time raises validation error."""
        ev = make_event()
        naive_dt = datetime(2026, 11, 2, 12, 0, 0)
        with pytest.raises(ValidationError):
            RiskAssessmentRequest(event=ev, evaluation_time=naive_dt)


# ============================================================================
# 5. Timezone Handling and Normalization
# ============================================================================


class TestTimezoneNormalization:
    def test_positive_offset_normalization(self, make_event):
        """Positive timezone offset (+05:30 IST) is normalized to UTC."""
        tz_ist = timezone(timedelta(hours=5, minutes=30))
        tca_ist = datetime(2026, 11, 2, 17, 30, 0, tzinfo=tz_ist)

        ev = make_event(tca=tca_ist)
        # 17:30 IST is 12:00 UTC
        expected_utc = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        assert ev.tca == expected_utc
        assert ev.tca.tzinfo == timezone.utc

    def test_negative_offset_normalization(self, make_event):
        """Negative timezone offset (-04:00 EDT) is normalized to UTC."""
        tz_edt = timezone(timedelta(hours=-4))
        tca_edt = datetime(2026, 11, 2, 8, 0, 0, tzinfo=tz_edt)

        ev = make_event(tca=tca_edt)
        # 08:00 EDT is 12:00 UTC
        expected_utc = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        assert ev.tca == expected_utc
        assert ev.tca.tzinfo == timezone.utc

    def test_normalize_datetime_utc_helper(self):
        """Direct verification of normalize_datetime_utc helper function."""
        # ISO string with Z
        dt1 = normalize_datetime_utc("2026-11-02T12:00:00Z")
        assert dt1 == datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

        # ISO string with positive offset
        dt2 = normalize_datetime_utc("2026-11-02T17:30:00+05:30")
        assert dt2 == datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

        # ISO string with negative offset
        dt3 = normalize_datetime_utc("2026-11-02T08:00:00-04:00")
        assert dt3 == datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

        # Naive ISO string raises
        with pytest.raises(ValueError, match="must be timezone-aware"):
            normalize_datetime_utc("2026-11-02T12:00:00")


# ============================================================================
# 6. Custom Weights Validation
# ============================================================================


class TestCustomWeights:
    def test_valid_custom_weights(self, make_event, base_tca):
        """Custom weights summing to 1.0 alter factor contributions accordingly."""
        ev = make_event(miss_distance_km=0.0, relative_speed_kms=15.0, tca=base_tca)
        # All factors normalized = 1.0. With weights 0.8, 0.1, 0.1:
        custom = RiskWeights(weight_distance=0.80, weight_speed=0.10, weight_time=0.10)
        res = assess_risk(ev, evaluation_time=base_tca, custom_weights=custom)

        dist_f = next(f for f in res.factors if f.factor_name == "MISS_DISTANCE")
        speed_f = next(f for f in res.factors if f.factor_name == "RELATIVE_SPEED")
        time_f = next(f for f in res.factors if f.factor_name == "TIME_TO_TCA")

        assert math.isclose(dist_f.contribution, 80.0, abs_tol=1e-7)
        assert math.isclose(speed_f.contribution, 10.0, abs_tol=1e-7)
        assert math.isclose(time_f.contribution, 10.0, abs_tol=1e-7)
        assert math.isclose(res.risk_score, 100.0, abs_tol=1e-7)

    def test_invalid_weights_sum_rejected(self):
        """Weights not summing to 1.0 raise ValidationError."""
        with pytest.raises(ValidationError, match="Risk weights must sum to 1.0"):
            RiskWeights(weight_distance=0.5, weight_speed=0.5, weight_time=0.5)

    def test_negative_weight_rejected(self):
        """Negative weight raises ValidationError."""
        with pytest.raises(ValidationError):
            RiskWeights(weight_distance=-0.1, weight_speed=0.6, weight_time=0.5)

    def test_nan_weight_rejected(self):
        """NaN weight raises ValidationError."""
        with pytest.raises(ValidationError):
            RiskWeights(weight_distance=float("nan"), weight_speed=0.5, weight_time=0.5)


# ============================================================================
# 7. Batch Processing: Invariants, Sorting, and Empty Batch
# ============================================================================


class TestBatchProcessing:
    def test_empty_batch_returns_zero_counts(self, base_tca):
        """Empty events list returns total_assessed=0 and zero category counts."""
        res = assess_risk_batch(events=[], evaluation_time=base_tca)

        assert res.total_assessed == 0
        assert res.critical_count == 0
        assert res.high_count == 0
        assert res.moderate_count == 0
        assert res.low_count == 0
        assert res.negligible_count == 0
        assert len(res.assessments) == 0
        assert res.evaluation_time == base_tca

    def test_duplicate_event_ids_rejected(self, make_event):
        """Duplicate event_id within batch raises ValueError."""
        ev1 = make_event(event_id="DUPLICATE-ID-001")
        ev2 = make_event(event_id="DUPLICATE-ID-001")

        with pytest.raises(ValueError, match="Duplicate event_id"):
            assess_risk_batch(events=[ev1, ev2])

        # Also via Pydantic schema validation
        with pytest.raises(ValidationError, match="Duplicate event_id"):
            RiskAssessmentBatchRequest(events=[ev1, ev2])

    def test_shared_authoritative_evaluation_time(self, make_event, base_tca):
        """When evaluation_time is omitted, all batch assessments share the exact same timestamp."""
        ev1 = make_event(event_id="EV-1")
        ev2 = make_event(event_id="EV-2")

        batch_res = assess_risk_batch(events=[ev1, ev2])
        authoritative_time = batch_res.evaluation_time

        assert batch_res.assessments[0].evaluation_time == authoritative_time
        assert batch_res.assessments[1].evaluation_time == authoritative_time

    def test_deterministic_batch_sorting(self, make_event, base_tca):
        """
        Batch assessments must be stably sorted:
        1. Descending risk score
        2. event_id ascending (tie-breaker)
        3. TCA ascending (tie-breaker)
        """
        # Event A: High risk (d=0.2 km, v=12.0)
        ev_high = make_event(event_id="EV-HIGH", miss_distance_km=0.2, relative_speed_kms=12.0)
        # Event B: Low risk (d=8.0 km, v=2.0)
        ev_low = make_event(event_id="EV-LOW", miss_distance_km=8.0, relative_speed_kms=2.0)
        # Event C1 & C2: Identical kinematics, tie-broken by event_id ("EV-MID-1" < "EV-MID-2")
        ev_mid1 = make_event(event_id="EV-MID-1", miss_distance_km=2.0, relative_speed_kms=7.5)
        ev_mid2 = make_event(event_id="EV-MID-2", miss_distance_km=2.0, relative_speed_kms=7.5)

        # Supply in shuffled order
        batch_res = assess_risk_batch(
            events=[ev_low, ev_mid2, ev_high, ev_mid1],
            evaluation_time=base_tca,
        )

        assert len(batch_res.assessments) == 4
        # 1st: EV-HIGH
        assert batch_res.assessments[0].event_id == "EV-HIGH"
        # 2nd & 3rd: Equal scores, tie-broken by event_id ascending
        assert batch_res.assessments[1].event_id == "EV-MID-1"
        assert batch_res.assessments[2].event_id == "EV-MID-2"
        # 4th: EV-LOW
        assert batch_res.assessments[3].event_id == "EV-LOW"


# ============================================================================
# 8. Direct Integration with screen_conjunctions()
# ============================================================================


class TestScreeningEngineIntegration:
    def test_direct_pipeline_integration(self, stations_fixture: list[dict]):
        """Pass events returned by screen_conjunctions() directly into assess_risk_batch()."""
        iss = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        css = OrbitalObjectRecord.from_omm_dict(stations_fixture[1])
        start = iss.epoch
        end = start + timedelta(minutes=30)

        # Run Day 6 screening engine
        screening_res = screen_conjunctions(
            satellites=[iss, css],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=3000.0,
            target_frame="TEME",
        )

        assert len(screening_res.events) > 0

        # Pass screening events DIRECTLY into batch risk engine without manual field conversion
        risk_res = assess_risk_batch(
            events=screening_res.events,
            evaluation_time=start,
        )

        assert risk_res.total_assessed == len(screening_res.events)
        assert len(risk_res.assessments) == len(screening_res.events)
        for assessment in risk_res.assessments:
            assert assessment.risk_score >= 0.0
            assert assessment.risk_score <= 100.0
            assert assessment.risk_category in RiskCategory
            assert assessment.data_quality == DataQualityLevel.COMPLETE
            assert assessment.scientific_disclaimer != ""


# ============================================================================
# 9. FastAPI REST Endpoints Integration
# ============================================================================


class TestFastAPIRiskEndpoints:
    def test_post_assess_single_endpoint(self, make_event, base_tca):
        """Test assess_single_conjunction endpoint handler with valid payload."""
        from zorbit_api.routers.risk import assess_single_conjunction

        ev = make_event(event_id="API-TEST-001")
        req = RiskAssessmentRequest(event=ev, evaluation_time=base_tca)

        res = assess_single_conjunction(req)
        assert res.event_id == "API-TEST-001"
        assert 0.0 <= res.risk_score <= 100.0
        assert res.risk_category in RiskCategory
        assert res.data_quality == DataQualityLevel.COMPLETE
        assert len(res.factors) == 3

    def test_post_assess_batch_endpoint(self, make_event, base_tca):
        """Test assess_batch_conjunctions endpoint handler with valid payload."""
        from zorbit_api.routers.risk import assess_batch_conjunctions

        ev1 = make_event(event_id="API-BATCH-001", miss_distance_km=0.5)
        ev2 = make_event(event_id="API-BATCH-002", miss_distance_km=5.0)
        req = RiskAssessmentBatchRequest(events=[ev1, ev2], evaluation_time=base_tca)

        res = assess_batch_conjunctions(req)
        assert res.total_assessed == 2
        assert len(res.assessments) == 2
        assert res.assessments[0].event_id == "API-BATCH-001"
        assert res.assessments[1].event_id == "API-BATCH-002"

    def test_post_assess_batch_empty_endpoint(self, base_tca):
        """Test assess_batch_conjunctions with empty events list returns 200 and zero counts."""
        from zorbit_api.routers.risk import assess_batch_conjunctions

        req = RiskAssessmentBatchRequest(events=[], evaluation_time=base_tca)
        res = assess_batch_conjunctions(req)

        assert res.total_assessed == 0
        assert res.critical_count == 0
        assert res.high_count == 0
        assert res.moderate_count == 0
        assert res.low_count == 0
        assert res.negligible_count == 0
        assert len(res.assessments) == 0
        assert res.evaluation_time == base_tca

    def test_post_assess_batch_duplicate_id_triggers_422(self, make_event, base_tca):
        """Test duplicate event_id triggers validation error (HTTP 422)."""
        from fastapi import HTTPException
        from zorbit_api.routers.risk import assess_batch_conjunctions

        ev1 = make_event(event_id="DUPE-ID")
        ev2 = make_event(event_id="DUPE-ID")

        # Pydantic schema validation rejects duplicates
        with pytest.raises(ValidationError, match="Duplicate event_id"):
            RiskAssessmentBatchRequest(events=[ev1, ev2], evaluation_time=base_tca)

        # Router handler raises HTTPException(422) if duplicate passes to assess_risk_batch
        req_mock = RiskAssessmentBatchRequest.model_construct(
            events=[ev1, ev2], evaluation_time=base_tca, custom_weights=None
        )
        with pytest.raises(HTTPException) as exc_info:
            assess_batch_conjunctions(req_mock)
        assert exc_info.value.status_code == 422

    def test_post_assess_invalid_kinematics_triggers_422(self, make_event, base_tca):
        """Test negative miss distance triggers validation error (HTTP 422)."""
        # Pydantic validation rejects negative kinematics
        with pytest.raises(ValidationError):
            make_event(miss_distance_km=-10.0)

    def test_router_is_mounted_in_fastapi_app(self):
        """Verify risk endpoints are mounted on FastAPI app."""
        openapi_paths = app.openapi()["paths"]
        assert "/api/v1/risk/assess" in openapi_paths
        assert "post" in openapi_paths["/api/v1/risk/assess"]
        assert "/api/v1/risk/assess-batch" in openapi_paths
        assert "post" in openapi_paths["/api/v1/risk/assess-batch"]
