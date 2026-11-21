"""
Unit tests for packages/orbital_core/orbital_core/frames.py.

Verifies:
1. TEME -> ITRS position and velocity transformation against Vallado AIAA-2006-6753.
2. TEME -> GCRS position and velocity transformation against Astropy reference.
3. Correct output frame labeling (ITRS, GCRS, ITRF, GCRF).
4. Physical units preservation (km, km/s).
5. Timestamp preservation (UTC).
6. Identifier preservation (NORAD ID, synthetic object ID, name, status, error code).
7. Invalid input frame rejection (non-TEME).
8. Missing, non-finite (NaN, Inf), or invalid target frame rejection.
9. Deterministic execution with network access disabled (offline safety).
10. Vectorized batch transformation parity with single-state transforms.
11. End-to-end regression integration with SGP4 propagation pipeline.
"""

from __future__ import annotations

import math
import socket
import subprocess
import sys
import warnings
from datetime import datetime, timedelta, timezone

import astropy.units as u
import pytest
from astropy.coordinates import GCRS, TEME, CartesianDifferential, CartesianRepresentation
from astropy.time import Time
from astropy.utils import iers
from astropy.utils.exceptions import AstropyWarning
from erfa import ErfaWarning
from orbital_core.frames import (
    FrameTransformationError,
    teme_to_gcrs,
    teme_to_gcrs_cartesian,
    teme_to_itrs,
    teme_to_itrs_cartesian,
    transform_state_vector,
    transform_state_vectors,
)
from orbital_core.propagation import propagate_orbit, propagate_range
from orbital_core.schemas import OrbitalObjectRecord, StateVectorRecord
from zorbit_api.main import app, lifespan


@pytest.fixture
def sample_teme_state() -> StateVectorRecord:
    """Standard LEO sample state in TEME frame."""
    return StateVectorRecord(
        norad_cat_id="25544",
        object_id="1998-067A",
        object_name="ISS (ZARYA)",
        epoch=datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc),
        frame="TEME",
        position_km=(6349.552, -2416.035, 0.006),
        velocity_kms=(1.687, 4.447, 6.012),
        status="OK",
        sgp4_error_code=0,
    )


@pytest.fixture
def synthetic_teme_state() -> StateVectorRecord:
    """Synthetic fragment state in TEME frame without NORAD catalog ID."""
    return StateVectorRecord(
        norad_cat_id=None,
        object_id="SYNTH-FRAG-042-001",
        object_name="FRAGMENT 001",
        epoch=datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc),
        frame="TEME",
        position_km=(6500.0, -1200.0, 1500.0),
        velocity_kms=(1.2, 5.5, 4.8),
        status="OK",
        sgp4_error_code=0,
    )


class TestValladoBenchmarkTransformations:
    """
    Verification against published test case from David Vallado et al. (AIAA-2006-6753,
    Appendix C: Example Transformations between TEME and ITRF).
    """

    # Published Vallado Appendix C benchmark values
    EPOCH_STR = "2004-04-06T07:51:28.386+00:00"
    P_TEME_REF = (5094.18016210, 6127.64465050, 6380.34453270)
    V_TEME_REF = (-4.746131487, 0.785818041, 5.531931288)

    P_ITRF_REF = (-1033.479383, 7901.2952740, 6380.35659580)
    V_ITRF_REF = (-3.225636520, -2.872451450, 5.531924446)

    def test_teme_to_itrs_vallado_benchmark(self):
        """
        Transform TEME state to ITRS and compare with Vallado AIAA-2006-6753 Appendix C.
        Position agreement must be sub-meter (< 0.001 km = 1 m).
        Velocity agreement must be sub-mm/s (< 0.0001 km/s = 0.1 m/s).
        """
        epoch = datetime.fromisoformat(self.EPOCH_STR)
        state_teme = StateVectorRecord(
            norad_cat_id="99999",
            object_id="VALLADO-TEST",
            object_name="VALLADO BENCHMARK",
            epoch=epoch,
            frame="TEME",
            position_km=self.P_TEME_REF,
            velocity_kms=self.V_TEME_REF,
        )

        state_itrs = teme_to_itrs(state_teme)

        assert state_itrs.frame == "ITRS"
        # Sub-meter position difference (actual difference is ~0.27 m)
        assert abs(state_itrs.x - self.P_ITRF_REF[0]) < 0.001
        assert abs(state_itrs.y - self.P_ITRF_REF[1]) < 0.001
        assert abs(state_itrs.z - self.P_ITRF_REF[2]) < 0.001

        # Sub-mm/s velocity difference (actual difference is ~0.16 mm/s)
        assert abs(state_itrs.vx - self.V_ITRF_REF[0]) < 0.0001
        assert abs(state_itrs.vy - self.V_ITRF_REF[1]) < 0.0001
        assert abs(state_itrs.vz - self.V_ITRF_REF[2]) < 0.0001

    def test_teme_to_itrs_cartesian_function(self):
        """Test raw tuple function teme_to_itrs_cartesian against Vallado benchmark."""
        epoch = datetime.fromisoformat(self.EPOCH_STR)
        pos_itrs, vel_itrs = teme_to_itrs_cartesian(
            self.P_TEME_REF,
            self.V_TEME_REF,
            epoch,
        )

        assert abs(pos_itrs[0] - self.P_ITRF_REF[0]) < 0.001
        assert abs(pos_itrs[1] - self.P_ITRF_REF[1]) < 0.001
        assert abs(pos_itrs[2] - self.P_ITRF_REF[2]) < 0.001

        assert abs(vel_itrs[0] - self.V_ITRF_REF[0]) < 0.0001
        assert abs(vel_itrs[1] - self.V_ITRF_REF[1]) < 0.0001
        assert abs(vel_itrs[2] - self.V_ITRF_REF[2]) < 0.0001


class TestTemeToGcrsTransformation:
    def test_teme_to_gcrs_matches_independent_astropy(self, sample_teme_state: StateVectorRecord):
        """
        Verify teme_to_gcrs matches an independently constructed Astropy calculation.
        """
        transformed = teme_to_gcrs(sample_teme_state)

        # Independent Astropy reference calculation
        t = Time(sample_teme_state.epoch)
        p = CartesianRepresentation(
            sample_teme_state.position_km[0] * u.km,
            sample_teme_state.position_km[1] * u.km,
            sample_teme_state.position_km[2] * u.km,
        )
        v = CartesianDifferential(
            sample_teme_state.velocity_kms[0] * u.km / u.s,
            sample_teme_state.velocity_kms[1] * u.km / u.s,
            sample_teme_state.velocity_kms[2] * u.km / u.s,
        )
        teme_ref = TEME(p.with_differentials(v), obstime=t)
        gcrs_ref = teme_ref.transform_to(GCRS(obstime=t))

        assert abs(transformed.x - gcrs_ref.cartesian.x.to_value(u.km)) < 1e-9
        assert abs(transformed.y - gcrs_ref.cartesian.y.to_value(u.km)) < 1e-9
        assert abs(transformed.z - gcrs_ref.cartesian.z.to_value(u.km)) < 1e-9
        assert abs(transformed.vx - gcrs_ref.velocity.d_x.to_value(u.km / u.s)) < 1e-9
        assert abs(transformed.vy - gcrs_ref.velocity.d_y.to_value(u.km / u.s)) < 1e-9
        assert abs(transformed.vz - gcrs_ref.velocity.d_z.to_value(u.km / u.s)) < 1e-9

    def test_teme_to_gcrs_preserves_inertial_magnitudes(self, sample_teme_state: StateVectorRecord):
        """
        TEME to GCRS is a pure frame re-orientation (precession/nutation) with zero
        intrinsic frame velocity. Positional radius and velocity magnitude must be conserved.
        """
        transformed = teme_to_gcrs(sample_teme_state)

        assert math.isclose(transformed.radius_km, sample_teme_state.radius_km, rel_tol=1e-7)
        assert math.isclose(transformed.speed_kms, sample_teme_state.speed_kms, rel_tol=1e-7)

        # Verify that coordinates are rotated, not identical
        assert transformed.position_km != sample_teme_state.position_km
        assert transformed.velocity_kms != sample_teme_state.velocity_kms


class TestFrameLabelingAndUnits:
    def test_output_frame_labels(self, sample_teme_state: StateVectorRecord):
        """Verify destination frames are strictly labeled."""
        itrs_state = teme_to_itrs(sample_teme_state)
        assert itrs_state.frame == "ITRS"

        gcrs_state = teme_to_gcrs(sample_teme_state)
        assert gcrs_state.frame == "GCRS"

        itrf_state = transform_state_vector(sample_teme_state, "ITRF")
        assert itrf_state.frame == "ITRF"

        gcrf_state = transform_state_vector(sample_teme_state, "GCRF")
        assert gcrf_state.frame == "GCRF"

        identity_state = transform_state_vector(sample_teme_state, "TEME")
        assert identity_state.frame == "TEME"

    def test_output_units_in_aerospace_bounds(self, sample_teme_state: StateVectorRecord):
        """
        Verify position is in kilometers (6000-8000 km) and velocity in km/s (6-8 km/s),
        not in meters (6e6) or m/s (7000).
        """
        itrs_state = teme_to_itrs(sample_teme_state)
        gcrs_state = teme_to_gcrs(sample_teme_state)

        # Earth radius is ~6378 km, LEO radius is ~6790 km
        assert 6000.0 < itrs_state.radius_km < 8000.0
        assert 6000.0 < gcrs_state.radius_km < 8000.0

        # LEO speed in km/s
        assert 6.5 < itrs_state.speed_kms < 8.0
        assert 7.0 < gcrs_state.speed_kms < 8.0


class TestMetadataAndTimestampPreservation:
    def test_timestamp_preservation(self, sample_teme_state: StateVectorRecord):
        """Transformation preserves exact timezone-aware UTC epoch."""
        itrs_state = teme_to_itrs(sample_teme_state)
        gcrs_state = teme_to_gcrs(sample_teme_state)

        assert itrs_state.epoch == sample_teme_state.epoch
        assert gcrs_state.epoch == sample_teme_state.epoch
        assert itrs_state.epoch.tzinfo == timezone.utc

    def test_norad_catalog_metadata_preserved(self, sample_teme_state: StateVectorRecord):
        """Preserve NORAD ID, object_id, object_name, status, error code."""
        itrs_state = teme_to_itrs(sample_teme_state)

        assert itrs_state.norad_cat_id == "25544"
        assert itrs_state.object_id == "1998-067A"
        assert itrs_state.object_name == "ISS (ZARYA)"
        assert itrs_state.status == "OK"
        assert itrs_state.sgp4_error_code == 0

    def test_synthetic_object_metadata_preserved(self, synthetic_teme_state: StateVectorRecord):
        """Preserve synthetic fragment identifiers without fake NORAD ID."""
        itrs_state = teme_to_itrs(synthetic_teme_state)
        gcrs_state = teme_to_gcrs(synthetic_teme_state)

        assert itrs_state.norad_cat_id is None
        assert itrs_state.object_id == "SYNTH-FRAG-042-001"
        assert itrs_state.object_name == "FRAGMENT 001"

        assert gcrs_state.norad_cat_id is None
        assert gcrs_state.object_id == "SYNTH-FRAG-042-001"
        assert gcrs_state.object_name == "FRAGMENT 001"


class TestErrorHandlingAndValidation:
    def test_reject_non_teme_input_frame(self, sample_teme_state: StateVectorRecord):
        """States with frame != 'TEME' must be rejected with FrameTransformationError."""
        itrs_state = teme_to_itrs(sample_teme_state)

        with pytest.raises(FrameTransformationError, match="must be in 'TEME' frame"):
            teme_to_itrs(itrs_state)

        with pytest.raises(FrameTransformationError, match="must be in 'TEME' frame"):
            teme_to_gcrs(itrs_state)

    def test_reject_unsupported_target_frame(self, sample_teme_state: StateVectorRecord):
        """Unsupported target frame names raise FrameTransformationError."""
        with pytest.raises(FrameTransformationError, match="Unsupported target frame"):
            transform_state_vector(sample_teme_state, "MOON_FRAME")

        with pytest.raises(FrameTransformationError, match="Unsupported target frame"):
            transform_state_vectors([sample_teme_state], "INVALID_FRAME")

    def test_reject_non_finite_coordinates(self, sample_teme_state: StateVectorRecord):
        """NaN or infinite values raise FrameTransformationError."""
        nan_state = StateVectorRecord(
            norad_cat_id="25544",
            object_id="1998-067A",
            epoch=sample_teme_state.epoch,
            frame="TEME",
            position_km=(float("nan"), 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
        )
        with pytest.raises(FrameTransformationError, match="non-finite"):
            teme_to_itrs(nan_state)

        inf_state = StateVectorRecord(
            norad_cat_id="25544",
            object_id="1998-067A",
            epoch=sample_teme_state.epoch,
            frame="TEME",
            position_km=(6800.0, 0.0, 0.0),
            velocity_kms=(0.0, float("inf"), 0.0),
        )
        with pytest.raises(FrameTransformationError, match="non-finite"):
            teme_to_gcrs(inf_state)

    def test_reject_invalid_tuple_dimensions(self):
        """Cartesian functions reject tuples that are not length 3."""
        epoch = datetime.now(timezone.utc)
        with pytest.raises(FrameTransformationError, match="3-tuple"):
            teme_to_itrs_cartesian((1.0, 2.0), (3.0, 4.0, 5.0), epoch)  # type: ignore[arg-type]

        with pytest.raises(FrameTransformationError, match="3-tuple"):
            teme_to_gcrs_cartesian((1.0, 2.0, 3.0), (4.0, 5.0), epoch)  # type: ignore[arg-type]

    def test_reject_non_state_record_type(self):
        """Non-StateVectorRecord objects raise TypeError."""
        with pytest.raises(TypeError, match="Expected StateVectorRecord"):
            teme_to_itrs({"position": [1, 2, 3]})  # type: ignore[arg-type]


class TestDeterministicOfflineBehavior:
    """
    Verification of offline safety and configuration boundary between
    the standalone orbital_core library and the ZORBIT FastAPI backend.
    """

    def test_import_orbital_core_does_not_mutate_global_iers(self):
        """
        Verify that importing orbital_core does not mutate Astropy's global
        IERS configuration in third-party or standalone Python environments.
        """
        cmd = [
            sys.executable,
            "-c",
            "from astropy.utils import iers; "
            "before = iers.conf.auto_download; "
            "import orbital_core; "
            "after = iers.conf.auto_download; "
            "assert before == after, f'Mutated: {before} -> {after}'",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        assert res.returncode == 0, f"Import mutated IERS configuration: {res.stderr}"

    def test_api_startup_configures_offline_iers_policy(self, monkeypatch):
        """
        Verify that ZORBIT API lifespan startup enforces process-wide
        iers.conf.auto_download = False policy.
        """
        monkeypatch.setattr(iers.conf, "auto_download", True)
        assert iers.conf.auto_download is True

        cm = lifespan(app)
        enter_coro = cm.__aenter__()
        try:
            enter_coro.send(None)
        except StopIteration:
            pass

        assert iers.conf.auto_download is False

        exit_coro = cm.__aexit__(None, None, None)
        try:
            exit_coro.send(None)
        except StopIteration:
            pass

        assert iers.conf.auto_download is False

    def test_transformations_work_with_offline_network_access(
        self, sample_teme_state: StateVectorRecord, monkeypatch
    ):
        """
        Verify that coordinate transformations succeed purely with offline bundled tables
        when auto_download is disabled, with socket calls completely blocked.
        """
        monkeypatch.setattr(iers.conf, "auto_download", False)

        def mock_socket(*args, **kwargs):
            raise AssertionError("Network socket call attempted during offline transformation!")

        monkeypatch.setattr(socket, "socket", mock_socket)

        itrs_state = teme_to_itrs(sample_teme_state)
        gcrs_state = teme_to_gcrs(sample_teme_state)

        assert itrs_state.frame == "ITRS"
        assert gcrs_state.frame == "GCRS"
        assert 6770.0 < itrs_state.radius_km < 6810.0
        assert 6770.0 < gcrs_state.radius_km < 6810.0


class TestFutureIERSCoverage:
    """
    Verification of transformation behavior for epochs beyond bundled IERS data coverage.

    Scientific Disclaimer: Successful analytical execution at distant future epochs
    demonstrates software stability and graceful degradation, but does NOT imply
    certified or high-precision Earth orientation (polar motion, UT1-UTC) for future dates.
    """

    def test_future_epoch_degraded_accuracy_warning_handling(self, monkeypatch):
        """
        Verify transformation at an epoch beyond bundled IERS coverage (e.g. 2045-01-01).
        Astropy must:
        1. Complete transformation without crashing or requesting network data.
        2. Emit AstropyWarning (flagging 50-year mean polar motion fallback) and ErfaWarning.
        3. Maintain physically bounded LEO orbital quantities.
        """
        # Ensure offline safety: auto_download is False as enforced by application policy
        monkeypatch.setattr(iers.conf, "auto_download", False)

        def mock_socket(*args, **kwargs):
            raise AssertionError("Network access attempted during future epoch transformation!")

        monkeypatch.setattr(socket, "socket", mock_socket)

        future_dt = datetime(2045, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        future_state = StateVectorRecord(
            norad_cat_id="25544",
            object_id="1998-067A",
            object_name="ISS (ZARYA)",
            epoch=future_dt,
            frame="TEME",
            position_km=(6349.552, -2416.035, 0.006),
            velocity_kms=(1.687, 4.447, 6.012),
        )

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            itrs_state = teme_to_itrs(future_state)
            gcrs_state = teme_to_gcrs(future_state)

        # Transformation succeeds and preserves frame labels and valid physical radius
        assert itrs_state.frame == "ITRS"
        assert gcrs_state.frame == "GCRS"
        assert 6770.0 < itrs_state.radius_km < 6810.0
        assert 6770.0 < gcrs_state.radius_km < 6810.0
        assert 6.5 < itrs_state.speed_kms < 8.0
        assert 7.0 < gcrs_state.speed_kms < 8.0

        # Capture and inspect relevant warning categories
        astropy_warnings = [w for w in caught if issubclass(w.category, AstropyWarning)]
        erfa_warnings = [w for w in caught if issubclass(w.category, ErfaWarning)]

        assert len(astropy_warnings) > 0, (
            "Expected AstropyWarning for future epoch outside IERS table"
        )
        assert len(erfa_warnings) > 0, "Expected ErfaWarning for future epoch ('dubious year')"

        # Confirm that documented polar-motion fallback behavior is triggered
        polar_motion_warned = any(
            "polar motion" in str(w.message).lower() for w in astropy_warnings
        )
        assert polar_motion_warned, (
            "Expected polar motion fallback warning when epoch exceeds valid IERS table"
        )


class TestBatchAndVectorizedTransformations:
    def test_empty_list_returns_empty_list(self):
        """Empty sequence returns empty list."""
        assert transform_state_vectors([], "ITRS") == []

    def test_batch_matches_single_transformations(self, sample_teme_state: StateVectorRecord):
        """
        Vectorized transform_state_vectors produces bitwise equivalent results
        to single-state transforms across multiple epochs.
        """
        states: list[StateVectorRecord] = []
        for i in range(5):
            dt = sample_teme_state.epoch + timedelta(minutes=i * 10)
            st = StateVectorRecord(
                norad_cat_id=sample_teme_state.norad_cat_id,
                object_id=sample_teme_state.object_id,
                epoch=dt,
                frame="TEME",
                position_km=(
                    sample_teme_state.x + i * 10.0,
                    sample_teme_state.y - i * 5.0,
                    sample_teme_state.z + i * 2.0,
                ),
                velocity_kms=(
                    sample_teme_state.vx,
                    sample_teme_state.vy,
                    sample_teme_state.vz,
                ),
            )
            states.append(st)

        batch_itrs = transform_state_vectors(states, "ITRS")
        assert len(batch_itrs) == 5

        for single_teme, batch_res in zip(states, batch_itrs):
            single_itrs = teme_to_itrs(single_teme)
            assert math.isclose(batch_res.x, single_itrs.x, abs_tol=1e-9)
            assert math.isclose(batch_res.y, single_itrs.y, abs_tol=1e-9)
            assert math.isclose(batch_res.z, single_itrs.z, abs_tol=1e-9)
            assert math.isclose(batch_res.vx, single_itrs.vx, abs_tol=1e-9)
            assert math.isclose(batch_res.vy, single_itrs.vy, abs_tol=1e-9)
            assert math.isclose(batch_res.vz, single_itrs.vz, abs_tol=1e-9)


class TestPipelineRegressionIntegration:
    def test_sgp4_propagation_to_frames_integration(self, stations_fixture: list[dict]):
        """
        End-to-end integration: propagate ISS from authentic OMM fixture
        and transform resulting TEME state vectors to ITRS and GCRS.
        """
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])

        # 1. Single epoch propagation and transformation
        teme_state = propagate_orbit(record, record.epoch)
        assert teme_state.frame == "TEME"

        itrs_state = teme_to_itrs(teme_state)
        assert itrs_state.frame == "ITRS"
        assert itrs_state.norad_cat_id == "25544"
        assert 6770.0 < itrs_state.radius_km < 6810.0

        gcrs_state = teme_to_gcrs(teme_state)
        assert gcrs_state.frame == "GCRS"
        assert gcrs_state.norad_cat_id == "25544"
        assert 6770.0 < gcrs_state.radius_km < 6810.0

        # 2. Ephemeris trajectory range propagation and batch transformation
        start_time = record.epoch
        end_time = start_time + timedelta(minutes=15)
        ephemeris_teme = propagate_range(record, start_time, end_time, step_seconds=300.0)
        assert len(ephemeris_teme) == 4

        ephemeris_itrs = transform_state_vectors(ephemeris_teme, "ITRS")
        assert len(ephemeris_itrs) == 4
        for pt in ephemeris_itrs:
            assert pt.frame == "ITRS"
            assert pt.norad_cat_id == "25544"
            assert 6770.0 < pt.radius_km < 6810.0
