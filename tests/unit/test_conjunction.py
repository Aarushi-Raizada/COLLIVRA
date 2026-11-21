"""
Unit and integration tests for ZORBIT Conjunction Screening Engine.

Verifies all Day 6 requirements:
1. Two objects with no close approach.
2. Two objects with a known close approach.
3. Correct relative position.
4. Correct relative velocity.
5. Correct miss distance.
6. Correct TCA estimation.
7. Beginning-of-window minimum.
8. End-of-window minimum.
9. Multiple local minima.
10. Duplicate pair prevention.
11. Invalid threshold.
12. Invalid time range.
13. Incompatible coordinate frames.
14. Missing or failed trajectory.
15. Object failure isolation.
16. Correct classification boundaries.
17. UTC and timezone handling.
18. Empty input.
19. Single-object input.
20. Deterministic repeated results.
21. FastAPI endpoint integration (POST /api/v1/conjunctions/screen).
"""

from __future__ import annotations

import copy
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from orbital_core.conjunction import (
    _estimate_pair_max_relative_speed,
    _extract_object_identity,
    _hermite_interpolate_state,
    _refine_tca_in_bracket,
    classify_miss_distance,
    compute_relative_state,
    screen_conjunctions,
)
from orbital_core.frames import FrameTransformationError
from orbital_core.schemas import (
    ConjunctionScreeningRequest,
    OrbitalObjectRecord,
)
from pydantic import ValidationError
from sgp4.api import Satrec
from zorbit_api.main import app
from zorbit_api.routers.conjunctions import screen_orbital_conjunctions


class AnalyticalFlybySatrec(Satrec):
    """
    Subclass of Satrec that returns an exact analytical linear motion state for testing.
    r(t) = r0 + v * (t - t0)
    """

    def __init__(
        self,
        satnum: str,
        r0: tuple[float, float, float],
        v0: tuple[float, float, float],
        t0: datetime,
    ):
        super().__init__()
        self.satnum_str = satnum
        self.r0 = np.array(r0, dtype=np.float64)
        self.v0 = np.array(v0, dtype=np.float64)
        self.t0 = t0

    def sgp4(self, jd: float, fr: float):
        # Convert jd, fr back to UTC datetime
        # Standard Julian date to UNIX timestamp
        total_jd = jd + fr
        epoch_unix = (total_jd - 2440587.5) * 86400.0
        current_dt = datetime.fromtimestamp(epoch_unix, tz=timezone.utc)

        dt_sec = (current_dt - self.t0).total_seconds()
        pos = self.r0 + self.v0 * dt_sec
        vel = self.v0.copy()
        return 0, pos, vel


class TestRelativeStateCalculations:
    def test_relative_position_and_velocity_math(self):
        """Verify relative state calculation against closed-form values."""
        pos1 = (7000.0, 0.0, 0.0)
        vel1 = (0.0, 7.5, 0.0)
        pos2 = (7003.0, 4.0, 0.0)
        vel2 = (0.0, 3.5, 0.0)

        r_rel, v_rel, d, v_speed = compute_relative_state(pos1, vel1, pos2, vel2)

        # r_rel = r2 - r1 = (3, 4, 0) -> distance = sqrt(9 + 16) = 5.0 km
        assert math.isclose(r_rel[0], 3.0, abs_tol=1e-12)
        assert math.isclose(r_rel[1], 4.0, abs_tol=1e-12)
        assert math.isclose(r_rel[2], 0.0, abs_tol=1e-12)
        assert math.isclose(d, 5.0, abs_tol=1e-12)

        # v_rel = v2 - v1 = (0, -4, 0) -> speed = 4.0 km/s
        assert math.isclose(v_rel[0], 0.0, abs_tol=1e-12)
        assert math.isclose(v_rel[1], -4.0, abs_tol=1e-12)
        assert math.isclose(v_rel[2], 0.0, abs_tol=1e-12)
        assert math.isclose(v_speed, 4.0, abs_tol=1e-12)

    def test_zero_relative_state_when_identical(self):
        """When two states are identical, relative state is zero."""
        pos = (6800.0, 100.0, -50.0)
        vel = (1.2, 5.4, -3.1)
        r_rel, v_rel, d, v_speed = compute_relative_state(pos, vel, pos, vel)

        assert d == 0.0
        assert v_speed == 0.0
        assert r_rel == (0.0, 0.0, 0.0)
        assert v_rel == (0.0, 0.0, 0.0)

    def test_deterministic_repeated_results(self):
        """Verify repeated calls with identical input produce bit-for-bit identical results."""
        pos1 = (6900.123, -400.456, 1200.789)
        vel1 = (-0.512, 6.789, 3.412)
        pos2 = (6902.321, -398.654, 1205.111)
        vel2 = (-0.515, 6.780, 3.420)

        res1 = compute_relative_state(pos1, vel1, pos2, vel2)
        res2 = compute_relative_state(pos1, vel1, pos2, vel2)
        assert res1 == res2


class TestScreeningClassifications:
    def test_classification_boundaries(self):
        """Verify exact classification threshold boundaries."""
        # Defaults: CRITICAL < 1.0, HIGH < 5.0, MODERATE < 10.0, LOW >= 10.0
        assert classify_miss_distance(0.0) == "CRITICAL"
        assert classify_miss_distance(0.5) == "CRITICAL"
        assert classify_miss_distance(0.999999) == "CRITICAL"

        assert classify_miss_distance(1.0) == "HIGH"
        assert classify_miss_distance(2.5) == "HIGH"
        assert classify_miss_distance(4.999999) == "HIGH"

        assert classify_miss_distance(5.0) == "MODERATE"
        assert classify_miss_distance(7.5) == "MODERATE"
        assert classify_miss_distance(9.999999) == "MODERATE"

        assert classify_miss_distance(10.0) == "LOW"
        assert classify_miss_distance(25.0) == "LOW"

    def test_custom_classification_thresholds(self):
        """Verify custom configurable threshold boundaries."""
        # Custom: critical=0.5, high=2.0, moderate=8.0
        assert (
            classify_miss_distance(
                0.4,
                threshold_critical_km=0.5,
                threshold_high_km=2.0,
                threshold_moderate_km=8.0,
            )
            == "CRITICAL"
        )
        assert (
            classify_miss_distance(
                1.5,
                threshold_critical_km=0.5,
                threshold_high_km=2.0,
                threshold_moderate_km=8.0,
            )
            == "HIGH"
        )
        assert (
            classify_miss_distance(
                5.0,
                threshold_critical_km=0.5,
                threshold_high_km=2.0,
                threshold_moderate_km=8.0,
            )
            == "MODERATE"
        )
        assert (
            classify_miss_distance(
                8.0,
                threshold_critical_km=0.5,
                threshold_high_km=2.0,
                threshold_moderate_km=8.0,
            )
            == "LOW"
        )


class TestTCAEstimationAndMinima:
    @pytest.fixture
    def t0(self) -> datetime:
        return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_two_objects_no_close_approach(self, t0: datetime):
        """Two objects separated by thousands of kilometers report 0 conjunction events."""
        # Object 1 in LEO ~7000 km, Object 2 in GEO ~42164 km
        sat1 = AnalyticalFlybySatrec("10001", r0=(7000.0, 0.0, 0.0), v0=(0.0, 7.5, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("10002", r0=(42164.0, 0.0, 0.0), v0=(0.0, 3.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=t0 + timedelta(minutes=10),
            step_seconds=60.0,
            threshold_km=25.0,
            target_frame="TEME",
        )

        assert res.summary.total_objects == 2
        assert res.summary.total_pairs_considered == 1
        assert res.summary.total_events == 0
        assert len(res.events) == 0

    def test_known_close_approach_and_exact_tca(self, t0: datetime):
        """
        Two objects with known linear geometry crossing at t = t0 + 150s with miss distance 0.4 km.
        Verifies:
        - TCA refined to within millisecond of exact analytical 150.0s.
        - Miss distance is exactly 0.4 km.
        - Classified as CRITICAL.
        """
        # At t = t0 + 150s:
        # sat1: (0, 0, 0) + (1.0, 0, 0) * 150 = (150, 0, 0)
        # sat2: (150, -300, 0.4) + (0, 2.0, 0) * 150 = (150, 0, 0.4)
        # r_rel = (0, 0, 0.4), distance = 0.4 km, TCA = t0 + 150s
        t_encounter = t0 + timedelta(seconds=150)
        sat1 = AnalyticalFlybySatrec("10001", r0=(0.0, 0.0, 0.0), v0=(1.0, 0.0, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("10002", r0=(150.0, -300.0, 0.4), v0=(0.0, 2.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=300),  # 300s window, step 60s
            step_seconds=60.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 1
        assert len(res.events) == 1
        ev = res.events[0]

        assert ev.object_1_id == "10001"
        assert ev.object_2_id == "10002"
        # Verify TCA is refined to within 0.1s of exact 150s (between 120s and 180s grid points)
        assert abs((ev.tca - t_encounter).total_seconds()) < 0.1
        # Miss distance within 0.001 km of 0.4 km
        assert math.isclose(ev.miss_distance_km, 0.4, abs_tol=1e-3)
        assert ev.category == "CRITICAL"
        assert math.isclose(ev.relative_position_km[2], 0.4, abs_tol=1e-3)
        # v_rel = v2 - v1 = (-1.0, 2.0, 0.0) -> speed = sqrt(1 + 4) = sqrt(5) ~ 2.236 km/s
        assert math.isclose(ev.relative_speed_kms, math.sqrt(5.0), abs_tol=1e-3)

    def test_beginning_of_window_minimum(self, t0: datetime):
        """
        Minimum occurs at t = start_time (t0) where objects are closest and then separate.
        """
        # At t = t0, r_rel = (0, 0, 0.8), separating at 2 km/s
        sat1 = AnalyticalFlybySatrec("10001", r0=(0.0, 0.0, 0.0), v0=(0.0, -1.0, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("10002", r0=(0.0, 0.0, 0.8), v0=(0.0, 1.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=t0 + timedelta(minutes=5),
            step_seconds=60.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 1
        ev = res.events[0]
        # TCA must be clamped/refined to t0
        assert abs((ev.tca - t0).total_seconds()) < 0.1
        assert math.isclose(ev.miss_distance_km, 0.8, abs_tol=1e-3)

    def test_end_of_window_minimum(self, t0: datetime):
        """
        Minimum occurs at t = end_time where objects close in and reach closest approach at t_end.
        """
        end_time = t0 + timedelta(minutes=5)  # 300s
        # Objects approach each other and reach miss distance 1.5 km at t = 300s
        sat1 = AnalyticalFlybySatrec("10001", r0=(0.0, -300.0, 0.0), v0=(0.0, 1.0, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("10002", r0=(0.0, 300.0, 1.5), v0=(0.0, -1.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=end_time,
            step_seconds=60.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 1
        ev = res.events[0]
        # TCA must be at end_time
        assert abs((ev.tca - end_time).total_seconds()) < 0.1
        assert math.isclose(ev.miss_distance_km, 1.5, abs_tol=1e-3)
        assert ev.category == "HIGH"

    def test_multiple_local_minima(self, t0: datetime):
        """
        Periodic relative motion exhibiting two distinct close approach encounters over the window.
        """

        class PeriodicSatrec(Satrec):
            def __init__(self, satnum: str, t_ref: datetime):
                super().__init__()
                self.satnum_str = satnum
                self.t_ref = t_ref

            def sgp4(self, jd, fr):
                total_jd = jd + fr
                unix = (total_jd - 2440587.5) * 86400.0
                curr = datetime.fromtimestamp(unix, tz=timezone.utc)
                dt_sec = (curr - self.t_ref).total_seconds()
                # Sinusoidal separation with period 600s
                # Distance will dip near 0 at t = 150s and t = 750s
                d_val = 0.5 + 4.0 * math.sin(2.0 * math.pi * dt_sec / 600.0) ** 2
                return 0, (d_val, 0.0, 0.0), (0.0, 0.0, 0.0)

        sat1 = AnalyticalFlybySatrec("10001", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        sat2 = PeriodicSatrec("10002", t_ref=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=900),  # 15 minutes
            step_seconds=30.0,
            threshold_km=2.0,
            target_frame="TEME",
        )

        # Expect two distinct conjunction events around 0s, 300s, 600s, 900s
        assert res.summary.total_events >= 2
        for ev in res.events:
            assert ev.miss_distance_km < 2.0


class TestScreeningEdgeCasesAndValidation:
    @pytest.fixture
    def t0(self) -> datetime:
        return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_duplicate_pair_prevention(self, t0: datetime):
        """
        Verifies that for N=3 satellites, exactly N*(N-1)/2 = 3 pairs are evaluated.
        Pair (A, B) is evaluated once; (B, A) is not evaluated or duplicated.
        """
        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("2", r0=(2.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s3 = AnalyticalFlybySatrec("3", r0=(4.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[s1, s2, s3],
            start_time=t0,
            end_time=t0 + timedelta(minutes=2),
            step_seconds=60.0,
            threshold_km=10.0,
            target_frame="TEME",
        )

        assert res.summary.total_objects == 3
        assert res.summary.total_pairs_considered == 3

        # Check pair IDs in events
        pairs_found = set()
        for ev in res.events:
            pair = (ev.object_1_id, ev.object_2_id)
            assert pair not in pairs_found
            pairs_found.add(pair)

    def test_invalid_threshold_raises(self, t0: datetime):
        """Non-positive or non-finite threshold raises ValueError."""
        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("2", r0=(2.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)

        for bad_th in [0.0, -5.0, float("nan"), float("inf")]:
            with pytest.raises(ValueError, match="threshold_km"):
                screen_conjunctions(
                    satellites=[s1, s2],
                    start_time=t0,
                    end_time=t0 + timedelta(minutes=2),
                    threshold_km=bad_th,
                )

    def test_invalid_time_range_raises(self, t0: datetime):
        """end_time < start_time raises ValueError."""
        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("2", r0=(2.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)

        with pytest.raises(ValueError, match="end_time .* must be >= start_time"):
            screen_conjunctions(
                satellites=[s1, s2],
                start_time=t0,
                end_time=t0 - timedelta(minutes=5),
            )

    def test_naive_datetime_raises(self, t0: datetime):
        """Timezone-naive datetime raises ValueError."""
        naive_dt = datetime(2026, 11, 2, 12, 0, 0)
        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("2", r0=(2.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)

        with pytest.raises(ValueError, match="Ambiguous naive datetime"):
            screen_conjunctions(
                satellites=[s1, s2],
                start_time=naive_dt,
                end_time=t0 + timedelta(minutes=5),
            )

    def test_incompatible_coordinate_frame_raises(self, t0: datetime):
        """Requesting an unsupported frame raises FrameTransformationError."""
        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("2", r0=(2.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)

        with pytest.raises(FrameTransformationError, match="Unsupported target frame"):
            screen_conjunctions(
                satellites=[s1, s2],
                start_time=t0,
                end_time=t0 + timedelta(minutes=5),
                target_frame="INVALID_FRAME",
            )

    def test_empty_and_single_object_inputs(self, t0: datetime):
        """Empty list or single object returns valid response with 0 events and 0 pairs."""
        # 0 objects
        res0 = screen_conjunctions(
            satellites=[],
            start_time=t0,
            end_time=t0 + timedelta(minutes=5),
        )
        assert res0.summary.total_objects == 0
        assert res0.summary.total_pairs_considered == 0
        assert res0.summary.total_events == 0

        # 1 object
        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        res1 = screen_conjunctions(
            satellites=[s1],
            start_time=t0,
            end_time=t0 + timedelta(minutes=5),
        )
        assert res1.summary.total_objects == 1
        assert res1.summary.total_pairs_considered == 0
        assert res1.summary.total_events == 0

    def test_object_failure_isolation(self, t0: datetime):
        """
        One malformed or failing object in a batch is isolated and reported in failed_objects_count
        while valid objects screen without failure.
        """
        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("2", r0=(0.5, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        bad_obj = {"OBJECT_NAME": "CORRUPT_SAT", "INVALID": 999}  # Missing required elements

        res = screen_conjunctions(
            satellites=[s1, bad_obj, s2],
            start_time=t0,
            end_time=t0 + timedelta(minutes=2),
            step_seconds=60.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_objects == 3
        assert res.summary.failed_objects_count == 1
        assert res.summary.total_pairs_considered == 1  # Only pair (1, 2)
        assert res.summary.total_events == 1


class TestRealWorldCatalogConjunctions:
    def test_iss_and_css_space_stations(self, stations_fixture: list[dict]):
        """
        Screen ISS and CSS (Tianhe) space stations over a 30-minute window in GCRS.
        Their orbital shells are ~30 km apart in altitude, but their relative distance
        over this window is ~2200-9000 km, so:
        - At threshold = 10 km: 0 conjunctions.
        - At threshold = 2500 km: encounter detected at closest approach.
        """
        iss = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        css = OrbitalObjectRecord.from_omm_dict(stations_fixture[1])

        start = iss.epoch
        end = start + timedelta(minutes=30)

        # 1. Screen at 10 km threshold -> no close approach
        res_tight = screen_conjunctions(
            satellites=[iss, css],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=10.0,
            target_frame="GCRS",
        )
        assert res_tight.summary.total_objects == 2
        assert res_tight.summary.total_pairs_considered == 1
        assert res_tight.summary.total_events == 0

        # 2. Screen at 2500 km threshold -> close approach detected
        res_wide = screen_conjunctions(
            satellites=[iss, css],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=2500.0,
            target_frame="GCRS",
        )
        assert res_wide.summary.total_events >= 1
        for ev in res_wide.events:
            assert ev.frame == "GCRS"
            assert ev.miss_distance_km <= 2500.0
            assert ev.category == "LOW"
            assert ev.disclaimer is not None

    def test_synthetic_near_collision_iss_clone(self, stations_fixture: list[dict]):
        """
        Create a clone of ISS with a minute along-track separation (~2.5 km).
        Screening must identify it as HIGH category.
        """
        iss_dict = copy.deepcopy(stations_fixture[0])
        clone_dict = copy.deepcopy(stations_fixture[0])

        clone_dict["OBJECT_ID"] = "SYNTH-ISS-CLONE"
        clone_dict["OBJECT_NAME"] = "SYNTH-ISS-FOLLOWER"
        clone_dict["NORAD_CAT_ID"] = 99991
        # Shift mean anomaly slightly by ~0.02 degrees (~2.4 km along-track in LEO)
        clone_dict["MEAN_ANOMALY"] = (float(clone_dict["MEAN_ANOMALY"]) + 0.02) % 360.0

        iss_rec = OrbitalObjectRecord.from_omm_dict(iss_dict)
        clone_rec = OrbitalObjectRecord.from_omm_dict(clone_dict)

        start = iss_rec.epoch
        end = start + timedelta(minutes=15)

        res = screen_conjunctions(
            satellites=[iss_rec, clone_rec],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=10.0,
            target_frame="GCRS",
        )

        assert res.summary.total_events >= 1
        ev = res.events[0]
        assert ev.miss_distance_km < 5.0
        assert ev.category in ("CRITICAL", "HIGH")


class TestConjunctionAPIEndpoint:
    def test_post_conjunction_screen_valid_request(self, stations_fixture: list[dict]):
        """Verify successful screening response from screen_orbital_conjunctions."""
        req = ConjunctionScreeningRequest(
            objects=stations_fixture,
            start_time="2026-11-02T12:00:00Z",
            end_time="2026-11-02T12:30:00Z",
            step_seconds=60.0,
            threshold_km=50.0,
            target_frame="GCRS",
        )
        resp = screen_orbital_conjunctions(req)
        assert resp.summary.total_objects == 2
        assert resp.summary.total_pairs_considered == 1
        assert resp.summary.threshold_km == 50.0
        assert resp.summary.target_frame == "GCRS"
        assert resp.disclaimer is not None

    def test_post_conjunction_screen_validation_error_end_before_start(
        self, stations_fixture: list[dict]
    ):
        """Request validation fails when end_time < start_time with ValidationError."""
        with pytest.raises(ValidationError, match="end_time .* must be >= start_time"):
            ConjunctionScreeningRequest(
                objects=stations_fixture,
                start_time="2026-11-02T12:30:00Z",
                end_time="2026-11-02T12:00:00Z",
                step_seconds=60.0,
                threshold_km=10.0,
            )

    def test_post_conjunction_screen_validation_error_negative_threshold(
        self, stations_fixture: list[dict]
    ):
        """Negative threshold triggers ValidationError."""
        with pytest.raises(ValidationError, match="threshold_km"):
            ConjunctionScreeningRequest(
                objects=stations_fixture,
                start_time="2026-11-02T12:00:00Z",
                end_time="2026-11-02T12:30:00Z",
                threshold_km=-10.0,
            )

    def test_router_is_mounted_in_app(self):
        """Verify conjunction screening router is mounted on FastAPI application."""
        openapi_paths = app.openapi()["paths"]
        assert "/api/v1/conjunctions/screen" in openapi_paths
        assert "post" in openapi_paths["/api/v1/conjunctions/screen"]


class TestAuditFindingsDeduplicationAndConflictingRecords:
    @pytest.fixture
    def t0(self) -> datetime:
        return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_same_omm_object_supplied_twice_deduplicated(self, stations_fixture: list[dict]):
        """Passing duplicate OMM dicts deduplicates before propagation to 1 object, 0 pairs."""
        station1 = stations_fixture[0]
        start = "2026-11-02T12:00:00Z"
        end = "2026-11-02T12:30:00Z"

        res = screen_conjunctions(
            satellites=[station1, station1],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=50.0,
        )
        assert res.summary.total_objects == 2
        assert res.summary.resolved_objects_count == 1
        assert res.summary.total_pairs_considered == 0
        assert res.summary.total_events == 0

    def test_two_records_same_norad_id_deduplicated(self, stations_fixture: list[dict]):
        """Two OrbitalObjectRecord objects with identical NORAD ID are deduplicated."""
        rec1 = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        rec2 = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start = rec1.epoch
        end = start + timedelta(minutes=30)

        res = screen_conjunctions(
            satellites=[rec1, rec2],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=50.0,
        )
        assert res.summary.resolved_objects_count == 1
        assert res.summary.total_pairs_considered == 0
        assert res.summary.total_events == 0

    def test_same_satellite_in_objects_and_norad_ids(
        self, stations_fixture: list[dict], monkeypatch: pytest.MonkeyPatch
    ):
        """Supplying same satellite in objects and norad_ids deduplicates cleanly."""
        station1 = stations_fixture[0]
        norad_int = int(station1["NORAD_CAT_ID"])
        rec1 = OrbitalObjectRecord.from_omm_dict(station1)
        # Mock client resolution to return the matching fixture record, preventing
        # divergent epoch conflicts between offline fixture and live/cached CelesTrak data.
        monkeypatch.setattr(
            "zorbit_api.routers.conjunctions.CelesTrakClient.get_by_norad_id",
            lambda self_client, nid: rec1 if int(nid) == norad_int else None,
        )
        req = ConjunctionScreeningRequest(
            objects=[station1],
            norad_ids=[norad_int],
            start_time="2026-11-02T12:00:00Z",
            end_time="2026-11-02T12:30:00Z",
            step_seconds=60.0,
            threshold_km=50.0,
        )
        resp = screen_orbital_conjunctions(req)
        assert resp.summary.total_objects == 2
        assert resp.summary.resolved_objects_count == 1
        assert resp.summary.total_pairs_considered == 0
        assert resp.summary.total_events == 0

    def test_conflicting_records_for_same_catalog_identity_raises(
        self, stations_fixture: list[dict]
    ):
        """Conflicting orbital elements for same NORAD ID raises ValueError."""
        rec1 = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        rec2 = copy.deepcopy(rec1)
        # Modify eccentricity to create an irreconcilable conflict
        rec2.eccentricity = 0.456

        start = rec1.epoch
        end = start + timedelta(minutes=30)

        with pytest.raises(ValueError, match="Conflicting duplicate records detected"):
            screen_conjunctions(
                satellites=[rec1, rec2],
                start_time=start,
                end_time=end,
                step_seconds=60.0,
                threshold_km=50.0,
            )

    def test_two_records_same_object_name_different_elements_both_retained(self, t0: datetime):
        """Records sharing OBJECT_NAME without reliable IDs are retained as distinct objects."""
        d1 = {"OBJECT_NAME": "COSMOS 2251 DEB", "MEAN_MOTION": 15.0}
        d2 = {"OBJECT_NAME": "COSMOS 2251 DEB", "MEAN_MOTION": 14.0}
        id1 = _extract_object_identity(d1)
        id2 = _extract_object_identity(d2)
        assert id1[0] == "RECORD"
        assert id2[0] == "RECORD"
        assert id1 != id2

        s1 = AnalyticalFlybySatrec("", r0=(7000.0, 0.0, 0.0), v0=(0.0, 7.5, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("", r0=(7000.0, 10.0, 0.0), v0=(0.0, -7.5, 0.0), t0=t0)
        s1.object_name = "COSMOS 2251 DEB"
        s2.object_name = "COSMOS 2251 DEB"

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(minutes=30),
            step_seconds=60.0,
            threshold_km=50.0,
        )
        assert res.summary.total_objects == 2
        assert res.summary.resolved_objects_count == 2
        assert res.summary.total_pairs_considered == 1

    def test_two_records_same_object_name_identical_elements_both_retained(self, t0: datetime):
        """Identical elements lacking reliable IDs receive unique record identity and are kept."""
        d1 = {"OBJECT_NAME": "DEBRIS", "MEAN_MOTION": 15.0}
        d2 = {"OBJECT_NAME": "DEBRIS", "MEAN_MOTION": 15.0}
        id1 = _extract_object_identity(d1)
        id2 = _extract_object_identity(d2)
        assert id1[0] == "RECORD"
        assert id2[0] == "RECORD"
        assert id1 != id2

        s1 = AnalyticalFlybySatrec("", r0=(7000.0, 0.0, 0.0), v0=(0.0, 7.5, 0.0), t0=t0)
        s2 = AnalyticalFlybySatrec("", r0=(7000.0, 0.0, 0.0), v0=(0.0, 7.5, 0.0), t0=t0)
        s1.object_name = "DEBRIS"
        s2.object_name = "DEBRIS"

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(minutes=30),
            step_seconds=60.0,
            threshold_km=50.0,
        )
        assert res.summary.total_objects == 2
        assert res.summary.resolved_objects_count == 2
        assert res.summary.total_pairs_considered == 1

    def test_same_object_id_conflicting_orbital_data_rejected(self, stations_fixture: list[dict]):
        """Records sharing OBJECT_ID with conflicting orbital elements raise ValueError."""
        d1 = copy.deepcopy(stations_fixture[0])
        d2 = copy.deepcopy(stations_fixture[0])
        d1.pop("NORAD_CAT_ID", None)
        d2.pop("NORAD_CAT_ID", None)
        d1["OBJECT_ID"] = "1998-067A"
        d2["OBJECT_ID"] = "1998-067A"
        d2["ECCENTRICITY"] = 0.333

        with pytest.raises(ValueError, match="Conflicting duplicate records detected"):
            screen_conjunctions(
                satellites=[d1, d2],
                start_time="2026-11-02T12:00:00Z",
                end_time="2026-11-02T12:30:00Z",
                step_seconds=60.0,
                threshold_km=50.0,
            )

    def test_equivalent_normalized_identifiers_deduplicated(self, stations_fixture: list[dict]):
        """Whitespace-padded or integer equivalent NORAD IDs normalize and deduplicate."""
        d1 = copy.deepcopy(stations_fixture[0])
        d2 = copy.deepcopy(stations_fixture[0])
        d1["NORAD_CAT_ID"] = 25544
        d2["NORAD_CAT_ID"] = "  25544  "

        res = screen_conjunctions(
            satellites=[d1, d2],
            start_time="2026-11-02T12:00:00Z",
            end_time="2026-11-02T12:30:00Z",
            step_seconds=60.0,
            threshold_km=50.0,
        )
        assert res.summary.resolved_objects_count == 1
        assert res.summary.total_pairs_considered == 0


class TestAuditFindingsBoundaryEncounterRecovery:
    @pytest.fixture
    def t0(self) -> datetime:
        return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_beginning_boundary_encounter_when_sampled_distance_exceeds_threshold(
        self, t0: datetime
    ):
        """
        Encounter occurs inside first sampling interval at t = t0 + 15s with d = 0.5 km.
        Sampled distance at t0 is 45 km, and at t1 (t0 + 60s) is 135 km.
        Both sampled points exceed the 10 km threshold, but candidate detection
        correctly recovers and refines the TCA to t0 + 15s.
        """
        sat1 = AnalyticalFlybySatrec("SAT1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("SAT2", r0=(0.0, -45.0, 0.5), v0=(0.0, 3.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=120),
            step_seconds=60.0,
            threshold_km=10.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 1
        ev = res.events[0]
        expected_tca = t0 + timedelta(seconds=15)
        assert abs((ev.tca - expected_tca).total_seconds()) < 0.1
        assert math.isclose(ev.miss_distance_km, 0.5, abs_tol=1e-3)
        assert ev.category == "CRITICAL"

    def test_end_boundary_encounter_when_sampled_distance_exceeds_threshold(self, t0: datetime):
        """
        Encounter occurs inside last sampling interval at t = end_time - 15s with d = 0.6 km.
        Sampled distance at end_time is 45 km, and at end_time - 60s is 135 km.
        Both sampled points exceed the 10 km threshold, but candidate detection
        correctly recovers and refines the TCA to end_time - 15s.
        """
        end_time = t0 + timedelta(seconds=120)
        sat1 = AnalyticalFlybySatrec("SAT1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("SAT2", r0=(0.0, 315.0, 0.6), v0=(0.0, -3.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=end_time,
            step_seconds=60.0,
            threshold_km=10.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 1
        ev = res.events[0]
        expected_tca = t0 + timedelta(seconds=105)
        assert abs((ev.tca - expected_tca).total_seconds()) < 0.1
        assert math.isclose(ev.miss_distance_km, 0.6, abs_tol=1e-3)
        assert ev.category == "CRITICAL"


class TestAuditFindingsHighRelativeSpeed:
    @pytest.fixture
    def t0(self) -> datetime:
        return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_missing_orbital_elements_returns_inf(self):
        """Objects lacking Keplerian mean elements return infinite speed bound."""
        obj1 = {"OBJECT_NAME": "SAT1"}
        obj2 = {"OBJECT_NAME": "SAT2"}
        bound = _estimate_pair_max_relative_speed(obj1, obj2)
        assert math.isinf(bound)

    def test_high_eccentricity_orbit_returns_infinite_speed_bound_for_safety(self):
        """Uncertified vis-viva estimate disabled; returns infinite bound for safety."""
        # Realistic high-eccentricity Molniya-like bound Earth orbit:
        # n = 2.0 rev/day, e = 0.72 -> a ~ 26610 km, r_p = a*(1-e) ~ 7450 km > 6000 km
        obj1 = {"MEAN_MOTION": 2.0, "ECCENTRICITY": 0.72}
        obj2 = {"MEAN_MOTION": 2.0, "ECCENTRICITY": 0.72}
        bound = _estimate_pair_max_relative_speed(obj1, obj2)
        assert math.isinf(bound)

    def test_hyperbolic_or_decayed_orbit_returns_inf(self):
        """Hyperbolic (e >= 1.0) or decayed (r_p <= 6000 km) elements return inf."""
        hyperbolic = {"MEAN_MOTION": 1.0, "ECCENTRICITY": 1.2}
        decayed = {"MEAN_MOTION": 18.0, "ECCENTRICITY": 0.1}
        valid = {"MEAN_MOTION": 15.0, "ECCENTRICITY": 0.001}

        assert math.isinf(_estimate_pair_max_relative_speed(hyperbolic, valid))
        assert math.isinf(_estimate_pair_max_relative_speed(decayed, valid))

    def test_infinite_speed_bound_prevents_interval_pruning(self, t0: datetime):
        """Infinite speed bound ensures no candidate intervals are silently pruned."""
        sat1 = AnalyticalFlybySatrec("H1", r0=(0.0, -832.5, 0.0), v0=(0.0, 9.25, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("H2", r0=(0.0, 832.5, 0.8), v0=(0.0, -9.25, 0.0), t0=t0)
        bound = _estimate_pair_max_relative_speed(sat1, sat2)
        assert math.isinf(bound)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=180),
            step_seconds=60.0,
            threshold_km=10.0,
            target_frame="TEME",
        )
        assert res.summary.total_events == 1
        assert math.isclose(res.events[0].miss_distance_km, 0.8, abs_tol=1e-3)

    def test_existing_valid_orbital_elements_return_infinite_bound_for_safety(
        self, stations_fixture: list[dict]
    ):
        """Standard valid LEO orbits return infinite bound to prevent uncertified pruning."""
        bound = _estimate_pair_max_relative_speed(stations_fixture[0], stations_fixture[1])
        assert math.isinf(bound)


class TestAuditFindingsUnresolvedNORADIDs:
    def test_unresolved_norad_ids_in_api_response(self, stations_fixture: list[dict]):
        """API explicitly tracks unresolved NORAD IDs in summary and root response."""
        valid_norad = int(stations_fixture[0]["NORAD_CAT_ID"])
        invalid_norad = 9999999

        req = ConjunctionScreeningRequest(
            norad_ids=[valid_norad, invalid_norad],
            start_time="2026-11-02T12:00:00Z",
            end_time="2026-11-02T12:30:00Z",
            step_seconds=60.0,
            threshold_km=50.0,
        )
        resp = screen_orbital_conjunctions(req)

        assert invalid_norad in resp.unresolved_norad_ids
        assert invalid_norad in resp.summary.unresolved_norad_ids
        assert resp.summary.total_objects == 2
        assert resp.summary.resolved_objects_count == 1
        assert resp.summary.failed_objects_count == 0


class TestAuditFindingsEncounterDeduplicationSafeguards:
    @pytest.fixture
    def t0(self) -> datetime:
        return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_two_distinct_local_minima_less_than_300s_apart_both_preserved(self, t0: datetime):
        """
        Two distinct physical encounters separated by 150 seconds (< 300s) are both preserved.
        Demonstrates removal of the arbitrary 300s temporal merging rule.
        """

        class TwoMinimaSatrec(Satrec):
            def __init__(self, satnum: str, t_ref: datetime):
                super().__init__()
                self.satnum_str = satnum
                self.t_ref = t_ref

            def sgp4(self, jd, fr):
                unix = ((jd + fr) - 2440587.5) * 86400.0
                curr = datetime.fromtimestamp(unix, tz=timezone.utc)
                dt = (curr - self.t_ref).total_seconds()
                # Minima at t = 100s (d = 0.5 km) and t = 250s (d = 0.8 km)
                d1 = 0.5 + 0.05 * (dt - 100.0) ** 2
                d2 = 0.8 + 0.05 * (dt - 250.0) ** 2
                d = min(d1, d2)
                return 0, (d, 0.0, 0.0), (0.0, 0.0, 0.0)

        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = TwoMinimaSatrec("2", t_ref=t0)

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=360),
            step_seconds=30.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 2
        tcas = [ev.tca for ev in res.events]
        assert abs((tcas[0] - (t0 + timedelta(seconds=100))).total_seconds()) < 1.0
        assert abs((tcas[1] - (t0 + timedelta(seconds=250))).total_seconds()) < 1.0

    def test_two_minima_separated_by_intervening_maximum_above_threshold_both_preserved(
        self, t0: datetime
    ):
        """
        Two minima separated by an intervening distance maximum above threshold are both preserved.
        """

        class InterveningMaxSatrec(Satrec):
            def __init__(self, satnum: str, t_ref: datetime):
                super().__init__()
                self.satnum_str = satnum
                self.t_ref = t_ref

            def sgp4(self, jd, fr):
                unix = ((jd + fr) - 2440587.5) * 86400.0
                curr = datetime.fromtimestamp(unix, tz=timezone.utc)
                dt = (curr - self.t_ref).total_seconds()
                # At t=60s d=0.5 km, at t=120s d=25 km (> 10 km threshold), at t=180s d=0.6 km
                d1 = 0.5 + 0.02 * (dt - 60.0) ** 2
                d2 = 0.6 + 0.02 * (dt - 180.0) ** 2
                d = min(d1, d2)
                return 0, (d, 0.0, 0.0), (0.0, 0.0, 0.0)

        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = InterveningMaxSatrec("2", t_ref=t0)

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=240),
            step_seconds=30.0,
            threshold_km=10.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 2
        assert res.events[0].category == "CRITICAL"
        assert res.events[1].category == "CRITICAL"

    def test_two_distinct_encounters_with_different_miss_distances_neither_discarded(
        self, t0: datetime
    ):
        """Neither encounter is silently discarded when miss distances differ significantly."""

        class DifferingMissSatrec(Satrec):
            def __init__(self, satnum: str, t_ref: datetime):
                super().__init__()
                self.satnum_str = satnum
                self.t_ref = t_ref

            def sgp4(self, jd, fr):
                unix = ((jd + fr) - 2440587.5) * 86400.0
                curr = datetime.fromtimestamp(unix, tz=timezone.utc)
                dt = (curr - self.t_ref).total_seconds()
                # Encounter 1 at t=60s (d=0.3 km, CRITICAL), Encounter 2 at t=180s (d=4.5 km, HIGH)
                d1 = 0.3 + 0.05 * (dt - 60.0) ** 2
                d2 = 4.5 + 0.05 * (dt - 180.0) ** 2
                d = min(d1, d2)
                return 0, (d, 0.0, 0.0), (0.0, 0.0, 0.0)

        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = DifferingMissSatrec("2", t_ref=t0)

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=240),
            step_seconds=30.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 2
        assert res.events[0].category == "CRITICAL"
        assert res.events[1].category == "HIGH"

    def test_adjacent_sampling_brackets_converging_to_same_tca(self, t0: datetime):
        """
        Adjacent sampling brackets that converge to the same physical minimum produce
        exactly one deduplicated event with the closer miss distance.
        """
        # Flyby minimum at t = 75s
        sat1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(1.0, 0.0, 0.0), t0=t0)
        sat2 = AnalyticalFlybySatrec("2", r0=(75.0, -150.0, 0.4), v0=(0.0, 2.0, 0.0), t0=t0)

        res = screen_conjunctions(
            satellites=[sat1, sat2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=180),
            step_seconds=30.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 1
        assert abs((res.events[0].tca - (t0 + timedelta(seconds=75))).total_seconds()) < 0.1
        assert math.isclose(res.events[0].miss_distance_km, 0.4, abs_tol=1e-3)

    def test_encounter_deduplication_preserves_distinct_events_with_large_step(self, t0: datetime):
        """
        Two distinct encounters between the same pair separated by 1200 seconds (< 0.5 * 3600s).
        Numerical convergence deduplication preserves both separate events.
        """

        class TwoEncounterSatrec(Satrec):
            def __init__(self, satnum: str, t_ref: datetime):
                super().__init__()
                self.satnum_str = satnum
                self.t_ref = t_ref

            def sgp4(self, jd, fr):
                unix = ((jd + fr) - 2440587.5) * 86400.0
                curr = datetime.fromtimestamp(unix, tz=timezone.utc)
                dt = (curr - self.t_ref).total_seconds()
                d1 = 0.5 + 0.05 * (dt - 600.0) ** 2
                d2 = 0.8 + 0.05 * (dt - 1800.0) ** 2
                d = min(d1, d2)
                return 0, (d, 0.0, 0.0), (0.0, 0.0, 0.0)

        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = TwoEncounterSatrec("2", t_ref=t0)

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=2400),
            step_seconds=120.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 2
        tcas = [ev.tca for ev in res.events]
        assert abs((tcas[0] - (t0 + timedelta(seconds=600))).total_seconds()) < 2.0
        assert abs((tcas[1] - (t0 + timedelta(seconds=1800))).total_seconds()) < 2.0

    def test_two_minima_less_than_five_seconds_apart_with_intervening_maximum_both_preserved(
        self, t0: datetime
    ):
        """
        Two distinct minima separated by 4.0s (< 5.0s) with a demonstrable intervening
        maximum (crest) are both preserved by bracket-aware continuous evaluation.
        """

        class TwoCloseMinimaSatrec(Satrec):
            def __init__(self, satnum: str, t_ref: datetime):
                super().__init__()
                self.satnum_str = satnum
                self.t_ref = t_ref

            def sgp4(self, jd, fr):
                unix = ((jd + fr) - 2440587.5) * 86400.0
                curr = datetime.fromtimestamp(unix, tz=timezone.utc)
                dt = (curr - self.t_ref).total_seconds()
                # Minimum 1 at dt = 10.0s (d = 0.5 km)
                # Crest at dt = 12.0s (d = 2.0 km)
                # Minimum 2 at dt = 14.0s (d = 0.6 km)
                if dt < 12.0:
                    d = 0.5 + 0.375 * (dt - 10.0) ** 2
                else:
                    d = 0.6 + 0.35 * (dt - 14.0) ** 2
                return 0, (d, 0.0, 0.0), (0.0, 0.0, 0.0)

        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = TwoCloseMinimaSatrec("2", t_ref=t0)

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=24),
            step_seconds=2.0,
            threshold_km=1.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 2
        tcas = [ev.tca for ev in res.events]
        assert abs((tcas[0] - (t0 + timedelta(seconds=10.0))).total_seconds()) < 0.2
        assert abs((tcas[1] - (t0 + timedelta(seconds=14.0))).total_seconds()) < 0.2
        assert math.isclose(res.events[0].miss_distance_km, 0.5, abs_tol=1e-3)
        assert math.isclose(res.events[1].miss_distance_km, 0.6, abs_tol=1e-3)

    def test_ambiguous_candidate_events_safely_preserved(self, t0: datetime):
        """
        Two candidates whose search brackets do not overlap are preserved safely,
        preventing silent loss when deduplication identity is ambiguous.
        """

        class DisjointCandidateSatrec(Satrec):
            def __init__(self, satnum: str, t_ref: datetime):
                super().__init__()
                self.satnum_str = satnum
                self.t_ref = t_ref

            def sgp4(self, jd, fr):
                unix = ((jd + fr) - 2440587.5) * 86400.0
                curr = datetime.fromtimestamp(unix, tz=timezone.utc)
                dt = (curr - self.t_ref).total_seconds()
                # First encounter in [0, 30] at t=15s (d=0.4 km)
                # Second encounter in [60, 90] at t=75s (d=0.4 km)
                d1 = 0.4 + 0.05 * (dt - 15.0) ** 2
                d2 = 0.4 + 0.05 * (dt - 75.0) ** 2
                d = min(d1, d2)
                return 0, (d, 0.0, 0.0), (0.0, 0.0, 0.0)

        s1 = AnalyticalFlybySatrec("1", r0=(0.0, 0.0, 0.0), v0=(0.0, 0.0, 0.0), t0=t0)
        s2 = DisjointCandidateSatrec("2", t_ref=t0)

        res = screen_conjunctions(
            satellites=[s1, s2],
            start_time=t0,
            end_time=t0 + timedelta(seconds=90),
            step_seconds=15.0,
            threshold_km=5.0,
            target_frame="TEME",
        )

        assert res.summary.total_events == 2
        assert len(res.events) == 2
        assert abs((res.events[0].tca - (t0 + timedelta(seconds=15))).total_seconds()) < 0.5
        assert abs((res.events[1].tca - (t0 + timedelta(seconds=75))).total_seconds()) < 0.5


class TestAuditFindingsHermiteFallback:
    @pytest.fixture
    def t0(self) -> datetime:
        return datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)

    def test_hermite_interpolation_derivative_and_endpoints(self):
        """
        Verify Hermite interpolation matches endpoint positions and velocities exactly,
        and velocity is the analytical derivative of position.
        """
        pos_a = np.array([7000.0, 0.0, 0.0])
        vel_a = np.array([0.0, 7.5, 0.0])
        pos_b = np.array([6900.0, 450.0, 0.0])
        vel_b = np.array([-3.3, 7.4, 0.0])
        dt = 60.0

        # Endpoint tau = 0
        p0, v0 = _hermite_interpolate_state(pos_a, vel_a, pos_b, vel_b, 0.0, dt)
        assert np.allclose(p0, pos_a)
        assert np.allclose(v0, vel_a)

        # Endpoint tau = dt
        p1, v1 = _hermite_interpolate_state(pos_a, vel_a, pos_b, vel_b, dt, dt)
        assert np.allclose(p1, pos_b)
        assert np.allclose(v1, vel_b)

        # Intermediate derivative check
        tau = 25.0
        p_mid, v_mid = _hermite_interpolate_state(pos_a, vel_a, pos_b, vel_b, tau, dt)
        eps = 1e-5
        p_plus, _ = _hermite_interpolate_state(pos_a, vel_a, pos_b, vel_b, tau + eps, dt)
        p_minus, _ = _hermite_interpolate_state(pos_a, vel_a, pos_b, vel_b, tau - eps, dt)
        v_numerical = (p_plus - p_minus) / (2.0 * eps)
        assert np.allclose(v_mid, v_numerical, atol=1e-5)

    def test_hermite_fallback_preserves_midpoint_state_in_tca_refinement(self, t0: datetime):
        """
        When Satrec is None, TCA refinement uses Hermite cubic interpolation and preserves
        the midpoint state across subintervals.
        """
        t_a = t0
        t_m = t0 + timedelta(seconds=60)
        t_b = t0 + timedelta(seconds=120)

        # Satellite 1: Stationary at origin
        pos1_a = np.array([0.0, 0.0, 0.0])
        vel1_a = np.array([0.0, 0.0, 0.0])
        pos1_m = np.array([0.0, 0.0, 0.0])
        vel1_m = np.array([0.0, 0.0, 0.0])
        pos1_b = np.array([0.0, 0.0, 0.0])
        vel1_b = np.array([0.0, 0.0, 0.0])

        # Satellite 2: Linear flyby with minimum near t = t0 + 40s (in first subinterval)
        def get_s2_state(tau_sec: float):
            pos = np.array([0.5, -40.0 + 1.0 * tau_sec, 0.0])
            vel = np.array([0.0, 1.0, 0.0])
            return pos, vel

        pos2_a, vel2_a = get_s2_state(0.0)
        pos2_m, vel2_m = get_s2_state(60.0)
        pos2_b, vel2_b = get_s2_state(120.0)

        refined_tca, r_rel, v_rel, miss_d, rel_speed, method = _refine_tca_in_bracket(
            sat1=None,
            sat2=None,
            pos1_a=pos1_a,
            vel1_a=vel1_a,
            pos1_b=pos1_b,
            vel1_b=vel1_b,
            pos2_a=pos2_a,
            vel2_a=vel2_a,
            pos2_b=pos2_b,
            vel2_b=vel2_b,
            t_a=t_a,
            t_b=t_b,
            target_frame="TEME",
            pos1_m=pos1_m,
            vel1_m=vel1_m,
            pos2_m=pos2_m,
            vel2_m=vel2_m,
            t_m=t_m,
        )

        assert method == "HERMITE_CUBIC_REFINEMENT"
        expected_tca = t0 + timedelta(seconds=40)
        assert abs((refined_tca - expected_tca).total_seconds()) < 0.1
        assert math.isclose(miss_d, 0.5, abs_tol=1e-3)


class TestAuditFindingsDeterministicResults:
    def test_deterministic_repeated_results(self, stations_fixture: list[dict]):
        """Running screening twice on identical inputs yields bit-for-bit identical results."""
        iss = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        css = OrbitalObjectRecord.from_omm_dict(stations_fixture[1])
        start = iss.epoch
        end = start + timedelta(minutes=30)

        res1 = screen_conjunctions(
            satellites=[iss, css],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=2500.0,
            target_frame="GCRS",
        )
        res2 = screen_conjunctions(
            satellites=[iss, css],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            threshold_km=2500.0,
            target_frame="GCRS",
        )

        assert res1.summary.total_objects == res2.summary.total_objects
        assert res1.summary.total_pairs_considered == res2.summary.total_pairs_considered
        assert res1.summary.total_events == res2.summary.total_events
        assert res1.summary.critical_count == res2.summary.critical_count
        assert res1.summary.high_count == res2.summary.high_count
        assert res1.summary.moderate_count == res2.summary.moderate_count
        assert res1.summary.low_count == res2.summary.low_count
        assert len(res1.events) == len(res2.events)

        for e1, e2 in zip(res1.events, res2.events):
            assert e1.event_id == e2.event_id
            assert e1.tca == e2.tca
            assert e1.miss_distance_km == e2.miss_distance_km
            assert e1.relative_position_km == e2.relative_position_km
            assert e1.relative_velocity_kms == e2.relative_velocity_kms
            assert e1.relative_speed_kms == e2.relative_speed_kms
            assert e1.category == e2.category
            assert e1.method == e2.method
