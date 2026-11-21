"""
Unit tests for packages/orbital_core/orbital_core/trajectory.py.

Verifies:
1. One satellite over multiple time points.
2. Multiple satellites in one batch.
3. Different orbital periods (LEO space stations, Starlink constellation, Cosmos-2251 debris).
4. Different sampling intervals (30s, 60s, 300s).
5. Correct UTC timestamp ordering and non-decayed monotonicity.
6. Position (km) and velocity (km/s) physical units and LEO bounds.
7. TEME output coordinate frame.
8. ITRS output coordinate frame.
9. GCRS output coordinate frame.
10. Metadata preservation (NORAD ID as string, COSPAR object_id, object_name).
11. Empty satellite collections return zero counts without error.
12. Invalid input handling (negative step, end < start, naive datetime, non-satellite object).
13. Single-point time window (start_time == end_time) produces exactly 1 point.
14. Non-divisible time window properly appends the final endpoint.
15. Individual satellite failure isolation (corrupt OMM does not fail valid satellites).
16. Exact regression consistency with single-point SGP4 propagate_orbit.
17. Exact consistency between batch trajectory and existing propagate_range.
18. Benchmarking multi-satellite execution performance across authentic catalog fixtures.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone

import pytest
from orbital_core.frames import FrameTransformationError
from orbital_core.propagation import PropagationError, propagate_orbit, propagate_range
from orbital_core.schemas import OrbitalObjectRecord
from orbital_core.trajectory import (
    generate_time_grid,
    propagate_satellite_trajectory,
    propagate_trajectories,
)
from sgp4.api import Satrec


class TestTimeGridGeneration:
    def test_time_grid_exact_multiple(self):
        """When window is an exact multiple of step_seconds."""
        start = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        end = datetime(2026, 11, 2, 12, 10, 0, tzinfo=timezone.utc)  # 600s
        grid = generate_time_grid(start, end, step_seconds=60.0)

        assert len(grid) == 11
        assert grid[0] == start
        assert grid[-1] == end
        for i in range(len(grid) - 1):
            assert (grid[i + 1] - grid[i]).total_seconds() == 60.0

    def test_time_grid_non_divisible_endpoint_inclusion(self):
        """When window is not evenly divisible by step_seconds, end_time is appended."""
        start = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        end = datetime(2026, 11, 2, 12, 2, 25, tzinfo=timezone.utc)  # 145s
        grid = generate_time_grid(start, end, step_seconds=60.0)

        # Expected: 0s, 60s, 120s, and endpoint 145s -> 4 points
        assert len(grid) == 4
        assert grid[0] == start
        assert grid[1] == start + timedelta(seconds=60)
        assert grid[2] == start + timedelta(seconds=120)
        assert grid[3] == end

    def test_time_grid_single_point_window(self):
        """When start_time == end_time, exactly one point is generated."""
        epoch = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        grid = generate_time_grid(epoch, epoch, step_seconds=60.0)

        assert len(grid) == 1
        assert grid[0] == epoch

    def test_time_grid_rejects_negative_or_zero_step(self):
        """step_seconds <= 0 raises ValueError."""
        epoch = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        with pytest.raises(ValueError, match="strictly positive"):
            generate_time_grid(epoch, epoch + timedelta(minutes=5), step_seconds=0.0)
        with pytest.raises(ValueError, match="strictly positive"):
            generate_time_grid(epoch, epoch + timedelta(minutes=5), step_seconds=-30.0)

    def test_time_grid_rejects_nan_and_infinities(self):
        """Sampling intervals of NaN, +inf, -inf raise ValueError."""
        epoch = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        for invalid_step in [float("nan"), float("inf"), float("-inf")]:
            with pytest.raises(ValueError, match="finite, strictly positive"):
                generate_time_grid(epoch, epoch + timedelta(minutes=5), step_seconds=invalid_step)

    def test_time_grid_rejects_end_before_start(self):
        """end_time < start_time raises ValueError."""
        start = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        end = datetime(2026, 11, 2, 11, 59, 0, tzinfo=timezone.utc)
        with pytest.raises(ValueError, match="end_time .* must be >= start_time"):
            generate_time_grid(start, end, step_seconds=60.0)

    def test_time_grid_rejects_naive_datetime(self):
        """Timezone-naive datetime raises ValueError."""
        start_naive = datetime(2026, 11, 2, 12, 0, 0)
        end_naive = datetime(2026, 11, 2, 12, 10, 0)
        with pytest.raises(ValueError, match="Ambiguous naive datetime"):
            generate_time_grid(start_naive, end_naive, step_seconds=60.0)


class TestSingleSatelliteTrajectory:
    def test_iss_single_satellite_teme(self, stations_fixture: list[dict]):
        """Propagate ISS over a 15-minute window in TEME frame."""
        iss = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start = iss.epoch
        end = start + timedelta(minutes=15)

        traj = propagate_satellite_trajectory(
            record_or_satrec=iss,
            start_time=start,
            end_time=end,
            step_seconds=180.0,
            target_frame="TEME",
        )

        assert traj.norad_cat_id == "25544"
        assert traj.object_name == "ISS (ZARYA)"
        assert traj.object_id == "1998-067A"
        assert traj.frame == "TEME"
        assert traj.position_unit == "km"
        assert traj.velocity_unit == "km/s"
        assert traj.status == "SUCCESS"
        assert traj.error_message is None
        assert traj.point_count == 6  # 0, 3, 6, 9, 12, 15 minutes

        # Verify physical sanity and units of points
        for pt in traj.points:
            assert pt.epoch.tzinfo == timezone.utc
            assert 6770.0 < pt.radius_km < 6810.0
            assert 7.60 < pt.speed_kms < 7.75

    def test_iss_trajectory_itrs_frame(self, stations_fixture: list[dict]):
        """Propagate ISS and verify output in ITRS (Earth-fixed) frame."""
        iss = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start = iss.epoch
        end = start + timedelta(minutes=10)

        traj = propagate_satellite_trajectory(
            record_or_satrec=iss,
            start_time=start,
            end_time=end,
            step_seconds=300.0,
            target_frame="ITRS",
        )

        assert traj.frame == "ITRS"
        assert traj.point_count == 3
        for pt in traj.points:
            assert 6770.0 < pt.radius_km < 6810.0
            # In rotating ITRS frame, speed reflects Earth transport subtraction
            assert 6.5 < pt.speed_kms < 8.0

    def test_iss_trajectory_gcrs_frame(self, stations_fixture: list[dict]):
        """Propagate ISS and verify output in GCRS (inertial) frame."""
        iss = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start = iss.epoch
        end = start + timedelta(minutes=10)

        traj = propagate_satellite_trajectory(
            record_or_satrec=iss,
            start_time=start,
            end_time=end,
            step_seconds=300.0,
            target_frame="GCRS",
        )

        assert traj.frame == "GCRS"
        assert traj.point_count == 3
        for pt in traj.points:
            assert 6770.0 < pt.radius_km < 6810.0
            assert 7.60 < pt.speed_kms < 7.75

    def test_single_satellite_unsupported_frame_raises(self, stations_fixture: list[dict]):
        """Requesting unsupported frame raises FrameTransformationError."""
        iss = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        with pytest.raises(FrameTransformationError, match="Unsupported target frame"):
            propagate_satellite_trajectory(
                record_or_satrec=iss,
                start_time=iss.epoch,
                end_time=iss.epoch + timedelta(minutes=5),
                target_frame="INVALID_FRAME",
            )


class TestMultiSatelliteBatchPropagation:
    def test_space_stations_batch(self, stations_fixture: list[dict]):
        """Propagate both ISS and CSS (Tianhe) together in one batch."""
        records = [OrbitalObjectRecord.from_omm_dict(d) for d in stations_fixture]
        start = records[0].epoch
        end = start + timedelta(minutes=20)

        batch = propagate_trajectories(
            satellites=records,
            start_time=start,
            end_time=end,
            step_seconds=300.0,
            target_frame="GCRS",
        )

        assert batch.count == 2
        assert batch.successful_count == 2
        assert batch.failed_count == 0
        assert batch.target_frame == "GCRS"
        assert batch.step_seconds == 300.0
        assert len(batch.trajectories) == 2

        iss_traj = batch.trajectories[0]
        css_traj = batch.trajectories[1]

        assert iss_traj.norad_cat_id == "25544"
        assert iss_traj.object_name == "ISS (ZARYA)"
        assert iss_traj.frame == "GCRS"
        assert iss_traj.point_count == 5

        assert css_traj.norad_cat_id == "48274"
        assert css_traj.object_name == "CSS (TIANHE)"
        assert css_traj.frame == "GCRS"
        assert css_traj.point_count == 5

    def test_heterogeneous_constellation_and_debris_batch(
        self,
        stations_fixture: list[dict],
        starlink_fixture: list[dict],
        debris_fixture: list[dict],
    ):
        """
        Propagate heterogeneous mix of 12 objects: space stations, Starlink, and debris.
        Verifies propagation across different orbital inclinations and altitudes.
        """
        all_records = (
            [OrbitalObjectRecord.from_omm_dict(d) for d in stations_fixture]
            + [OrbitalObjectRecord.from_omm_dict(d) for d in starlink_fixture]
            + [OrbitalObjectRecord.from_omm_dict(d) for d in debris_fixture]
        )
        assert len(all_records) == 12

        start = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        end = start + timedelta(minutes=30)

        batch = propagate_trajectories(
            satellites=all_records,
            start_time=start,
            end_time=end,
            step_seconds=600.0,
            target_frame="ITRS",
        )

        assert batch.count == 12
        assert batch.successful_count == 12
        assert batch.failed_count == 0

        for traj in batch.trajectories:
            assert traj.status == "SUCCESS"
            assert traj.frame == "ITRS"
            assert traj.point_count == 4  # 0, 10, 20, 30 min
            assert traj.norad_cat_id is not None
            # All are LEO objects: radius 6500 to 7500 km
            for pt in traj.points:
                assert 6500.0 < pt.radius_km < 7500.0

    def test_raw_omm_dictionaries_accepted(self, stations_fixture: list[dict]):
        """Verify that raw OMM dictionaries are accepted directly without prior model wrapping."""
        start = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        end = start + timedelta(minutes=5)

        batch = propagate_trajectories(
            satellites=stations_fixture,
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            target_frame="TEME",
        )

        assert batch.count == 2
        assert batch.successful_count == 2
        assert batch.trajectories[0].norad_cat_id == "25544"
        assert batch.trajectories[1].norad_cat_id == "48274"

    def test_empty_satellite_collection(self):
        """Empty input collection returns empty response without raising errors."""
        start = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        end = start + timedelta(minutes=10)

        batch = propagate_trajectories(
            satellites=[],
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            target_frame="GCRS",
        )

        assert batch.count == 0
        assert batch.successful_count == 0
        assert batch.failed_count == 0
        assert batch.trajectories == []
        assert batch.target_frame == "GCRS"


class MockDecayingSatrec(Satrec):
    """Satrec subclass that simulates an SGP4 decay error code 6 after N successful steps."""

    def __init__(self, record: OrbitalObjectRecord, fail_after_steps: int = 3):
        super().__init__()
        from sgp4 import omm
        from sgp4.api import WGS72

        fields = {
            "CLASSIFICATION_TYPE": record.classification_type,
            "OBJECT_ID": record.object_id,
            "EPHEMERIS_TYPE": record.ephemeris_type,
            "ELEMENT_SET_NO": record.element_set_no,
            "REV_AT_EPOCH": record.rev_at_epoch,
            "EPOCH": record.epoch.strftime("%Y-%m-%dT%H:%M:%S.%f"),
            "ARG_OF_PERICENTER": record.arg_of_pericenter,
            "BSTAR": record.bstar,
            "ECCENTRICITY": record.eccentricity,
            "INCLINATION": record.inclination,
            "MEAN_ANOMALY": record.mean_anomaly,
            "MEAN_MOTION_DDOT": record.mean_motion_ddot,
            "MEAN_MOTION_DOT": record.mean_motion_dot,
            "MEAN_MOTION": record.mean_motion,
            "RA_OF_ASC_NODE": record.ra_of_asc_node,
            "NORAD_CAT_ID": int(record.norad_cat_id),
        }
        omm.initialize(self, fields, WGS72)
        self.call_count = 0
        self.fail_after_steps = fail_after_steps
        self.satnum_str = str(record.norad_cat_id)

    def sgp4(self, jd, fr):
        self.call_count += 1
        if self.call_count > self.fail_after_steps:
            # Error code 6: orbit decayed
            return 6, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
        return super().sgp4(jd, fr)


class TestFailureIsolationAndErrorHandling:
    def test_single_bad_record_does_not_abort_batch(self, stations_fixture: list[dict]):
        """
        One malformed satellite record in a batch fails gracefully with status=FAILED
        while valid satellites propagate completely to status=SUCCESS.
        """
        good_record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        bad_record = {"OBJECT_NAME": "CORRUPT_SAT", "INVALID_FIELD": 123}  # Missing NORAD_CAT_ID

        start = good_record.epoch
        end = start + timedelta(minutes=10)

        batch = propagate_trajectories(
            satellites=[good_record, bad_record],
            start_time=start,
            end_time=end,
            step_seconds=300.0,
            target_frame="TEME",
            raise_on_error=False,
        )

        assert batch.count == 2
        assert batch.successful_count == 1
        assert batch.failed_count == 1

        # Good satellite succeeded
        good_traj = batch.trajectories[0]
        assert good_traj.norad_cat_id == "25544"
        assert good_traj.status == "SUCCESS"
        assert good_traj.point_count == 3

        # Bad satellite captured error with status FAILED
        bad_traj = batch.trajectories[1]
        assert bad_traj.status == "FAILED"
        assert bad_traj.error_message is not None
        assert bad_traj.point_count == 0

    def test_mid_trajectory_sgp4_failure_isolation(self, stations_fixture: list[dict]):
        """
        Verify that when a satellite encounters an SGP4 decay error mid-trajectory:
        1. Previously generated valid points are retained.
        2. No invalid state vector is appended.
        3. Status is PARTIAL.
        4. Error is recorded in error_message.
        5. Other satellites in the batch continue propagating to SUCCESS.
        """
        good_record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        other_record = OrbitalObjectRecord.from_omm_dict(stations_fixture[1])

        decaying_sat = MockDecayingSatrec(good_record, fail_after_steps=3)

        start = good_record.epoch
        end = start + timedelta(minutes=25)  # 6 steps at 300s: 0, 5, 10, 15, 20, 25 min

        batch = propagate_trajectories(
            satellites=[other_record, decaying_sat],
            start_time=start,
            end_time=end,
            step_seconds=300.0,
            target_frame="TEME",
            raise_on_error=False,
        )

        assert batch.count == 2
        assert batch.successful_count == 1
        assert batch.failed_count == 1

        # Other satellite completed completely
        other_traj = batch.trajectories[0]
        assert other_traj.status == "SUCCESS"
        assert other_traj.point_count == 6

        # Decaying satellite produced partial trajectory
        partial_traj = batch.trajectories[1]
        assert partial_traj.status == "PARTIAL"
        assert partial_traj.point_count == 3  # Steps 1, 2, 3 retained
        assert "SGP4 error 6" in str(partial_traj.error_message)

        # Verify points in partial trajectory are physically valid LEO states
        for pt in partial_traj.points:
            assert 6770.0 < pt.radius_km < 6810.0

    def test_failed_status_when_no_valid_points_can_be_generated(
        self, stations_fixture: list[dict]
    ):
        """
        When satellite fails at step 1 before any valid point can be generated,
        status is FAILED and points is empty.
        """
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        failing_sat = MockDecayingSatrec(record, fail_after_steps=0)

        start = record.epoch
        end = start + timedelta(minutes=10)

        traj = propagate_satellite_trajectory(
            record_or_satrec=failing_sat,
            start_time=start,
            end_time=end,
            step_seconds=300.0,
            target_frame="TEME",
            raise_on_error=False,
        )

        assert traj.status == "FAILED"
        assert traj.point_count == 0
        assert "SGP4 error 6" in str(traj.error_message)

    def test_raise_on_error_propagates_exception(self, stations_fixture: list[dict]):
        """When raise_on_error=True, invalid satellite raises PropagationError."""
        good_record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        bad_record = {"OBJECT_NAME": "CORRUPT_SAT"}

        start = good_record.epoch
        end = start + timedelta(minutes=10)

        with pytest.raises(PropagationError):
            propagate_trajectories(
                satellites=[good_record, bad_record],
                start_time=start,
                end_time=end,
                step_seconds=300.0,
                raise_on_error=True,
            )


class TestParityAndRegression:
    def test_parity_with_single_point_propagate_orbit(self, stations_fixture: list[dict]):
        """
        Verify that trajectory point at t = start_time is identical to
        single-point propagation via propagate_orbit.
        """
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        epoch = record.epoch

        # 1. Single-point propagate_orbit
        single_sv = propagate_orbit(record, epoch)

        # 2. Single-point trajectory window (start == end)
        traj = propagate_satellite_trajectory(
            record_or_satrec=record,
            start_time=epoch,
            end_time=epoch,
            step_seconds=60.0,
            target_frame="TEME",
        )

        assert traj.point_count == 1
        pt = traj.points[0]

        assert pt.epoch == single_sv.epoch
        assert math.isclose(pt.x, single_sv.x, abs_tol=1e-12)
        assert math.isclose(pt.y, single_sv.y, abs_tol=1e-12)
        assert math.isclose(pt.z, single_sv.z, abs_tol=1e-12)
        assert math.isclose(pt.vx, single_sv.vx, abs_tol=1e-12)
        assert math.isclose(pt.vy, single_sv.vy, abs_tol=1e-12)
        assert math.isclose(pt.vz, single_sv.vz, abs_tol=1e-12)

    def test_parity_with_propagate_range(self, stations_fixture: list[dict]):
        """
        Verify that multi-step trajectory in TEME matches propagate_range
        point-for-point.
        """
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start = record.epoch
        end = start + timedelta(minutes=15)
        step = 120.0

        range_states = propagate_range(record, start, end, step_seconds=step)
        traj = propagate_satellite_trajectory(
            record_or_satrec=record,
            start_time=start,
            end_time=end,
            step_seconds=step,
            target_frame="TEME",
        )

        assert len(range_states) == traj.point_count

        for sv, pt in zip(range_states, traj.points):
            assert sv.epoch == pt.epoch
            assert math.isclose(sv.x, pt.x, abs_tol=1e-12)
            assert math.isclose(sv.y, pt.y, abs_tol=1e-12)
            assert math.isclose(sv.z, pt.z, abs_tol=1e-12)
            assert math.isclose(sv.vx, pt.vx, abs_tol=1e-12)
            assert math.isclose(sv.vy, pt.vy, abs_tol=1e-12)
            assert math.isclose(sv.vz, pt.vz, abs_tol=1e-12)


class TestPerformanceBenchmark:
    def test_multi_satellite_propagation_benchmark(
        self,
        stations_fixture: list[dict],
        starlink_fixture: list[dict],
        debris_fixture: list[dict],
    ):
        """
        Benchmark execution speed for propagating 12 satellites over a 2-hour window
        at 60-second intervals (120 points per satellite = 1,440 total state vectors).
        Measures execution time and calculates throughput (states/sec).
        """
        all_records = (
            [OrbitalObjectRecord.from_omm_dict(d) for d in stations_fixture]
            + [OrbitalObjectRecord.from_omm_dict(d) for d in starlink_fixture]
            + [OrbitalObjectRecord.from_omm_dict(d) for d in debris_fixture]
        )

        start = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
        end = start + timedelta(hours=2)

        t0 = time.perf_counter()
        batch = propagate_trajectories(
            satellites=all_records,
            start_time=start,
            end_time=end,
            step_seconds=60.0,
            target_frame="GCRS",
        )
        elapsed_sec = time.perf_counter() - t0

        total_points = sum(t.point_count for t in batch.trajectories)
        throughput = total_points / elapsed_sec if elapsed_sec > 0 else float("inf")

        assert batch.count == 12
        assert batch.successful_count == 12
        assert total_points == 12 * 121  # 121 points per satellite (120 min + 1)

        # Baseline performance sanity: 1,452 GCRS points must complete in under 5.0 seconds
        assert elapsed_sec < 5.0, f"Benchmark took too long: {elapsed_sec:.3f}s"
        assert throughput > 200.0, f"Throughput too low: {throughput:.1f} states/sec"
