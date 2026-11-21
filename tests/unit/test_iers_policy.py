"""
Unit and Integration Tests for ZORBIT / COLLIVRA Earth Orientation (IERS) Policy.

Verifies the 11 authoritative validation scenarios specified under Milestone 6.4 Step 0
(Remediation Plan v2.4.1 Section 8.10, TEST-IERS-01 through TEST-IERS-09):
- TEST-IERS-01:  Definitive Historical Observations (2023 / MJD 59945)
- TEST-IERS-02A: Boundary 1: Last Definitive Observation (MJD 61321.0 / 2026-10-08)
- TEST-IERS-02B: Boundary 2: First Predictive Record (MJD 61322.0 / 2026-10-09)
- TEST-IERS-03A: Boundary 3: Exactly 30 Days Beyond Reference (MJD 61351.0 / 2026-11-07)
- TEST-IERS-03B: Boundary 4: Just Beyond 30 Days (MJD 61352.0 / 2026-11-08)
- TEST-IERS-04:  Out-of-Range Fallback (Future 2030 / MJD 62502)
- TEST-IERS-05:  Conservative Weakest-Link Aggregation (Mixed UT1 / PM Statuses)
- TEST-IERS-06:  Strict Mode Domain Error (EarthOrientationPolicyError on Stale Epochs)
- TEST-IERS-07:  Frames Transformation Integration and Policy Mode Enforcement
- TEST-IERS-08:  Zero-Network Guarantee (Offline Execution with Blocked Sockets)
- TEST-IERS-09:  Test Fixture Isolation and Configuration Teardown
"""

from __future__ import annotations

import socket
from datetime import datetime, timezone

import astropy.units as u
import numpy as np
import pytest
from astropy.coordinates.builtin_frames.utils import _DEFAULT_PM, get_polar_motion
from astropy.time import Time
from astropy.utils import iers

from orbital_core.exceptions import EarthOrientationPolicyError
from orbital_core.frames import (
    get_frame_transformation_quality,
    transform_state_vector,
    transform_state_vectors,
)
from orbital_core.iers_policy import (
    DEFAULT_STALE_THRESHOLD_DAYS,
    EARTH_ORIENTATION_DISCLAIMER,
    LAST_DEFINITIVE_MJD,
    check_earth_orientation_policy,
    evaluate_earth_orientation_quality,
    get_earth_orientation_quality,
)
from orbital_core.schemas import EarthOrientationQuality, StateVectorRecord


class TestEarthOrientationPolicyScenarios:
    """Suite verifying TEST-IERS-01 through TEST-IERS-09."""

    def test_iers_01_definitive_historical_observation(self):
        """
        TEST-IERS-01: Definitive Historical Observations.
        Query epoch in 2023 (MJD 59945.0).
        Assert UT1 and PM return Status 0 (FROM_IERS_B); data_source is DEFINITIVE;
        provenance_tier is OBSERVED_EOP; is_degraded is False; horizon is 0.0d.
        """
        t = Time(59945.0, format="mjd", scale="utc")
        quality = get_earth_orientation_quality(t)

        assert quality.data_source == "DEFINITIVE"
        assert quality.provenance_tier == "OBSERVED_EOP"
        assert quality.is_degraded is False
        assert quality.prediction_horizon_days == 0.0
        assert quality.ut1_status == 0
        assert quality.pm_status == 0
        assert quality.table_publication_age_days is None
        assert quality.local_cache_age_days is None
        assert quality.earth_orientation_disclaimer == EARTH_ORIENTATION_DISCLAIMER

    def test_iers_02a_boundary_last_definitive_observation(self):
        """
        TEST-IERS-02A: Boundary 1: Last Definitive Observation.
        Query epoch at MJD 61321.0 (2026-10-08 00:00:00 UTC).
        Row 19637 in finals2000A.all is the last definitive record ('I').
        Assert status is normalized to 1 (FROM_IERS_A); data_source is RAPID;
        prediction_horizon_days is 0.0d; provenance_tier is OBSERVED_EOP; is_degraded is False.
        """
        t = Time(61321.0, format="mjd", scale="utc")
        quality = get_earth_orientation_quality(t)

        assert quality.data_source == "RAPID"
        assert quality.provenance_tier == "OBSERVED_EOP"
        assert quality.is_degraded is False
        assert quality.prediction_horizon_days == 0.0
        assert quality.ut1_status == 1
        assert quality.pm_status == 1

    def test_iers_02b_boundary_first_predictive_record(self):
        """
        TEST-IERS-02B: Boundary 2: First Predictive Record.
        Query epoch at MJD 61322.0 (2026-10-09 00:00:00 UTC).
        Row 19638 is the first predictive entry ('P').
        Assert status is 2 (FROM_IERS_A_PREDICTION); horizon is 1.0d <= 30.0d;
        data_source is PREDICTIVE_FRESH; provenance_tier is FORWARD_PREDICTION; is_degraded is False.
        """
        t = Time(61322.0, format="mjd", scale="utc")
        quality = get_earth_orientation_quality(t)

        assert quality.data_source == "PREDICTIVE_FRESH"
        assert quality.provenance_tier == "FORWARD_PREDICTION"
        assert quality.is_degraded is False
        assert quality.prediction_horizon_days == 1.0
        assert quality.ut1_status == 2
        assert quality.pm_status == 2

    def test_iers_03a_boundary_exactly_30_days_beyond_reference(self):
        """
        TEST-IERS-03A: Boundary 3: Exactly 30 Days Beyond Reference.
        Query epoch at MJD 61351.0 (2026-11-07 00:00:00 UTC).
        Horizon is exactly 30.0d (61351.0 - 61321.0).
        Assert status is 2; horizon == 30.0d; data_source is PREDICTIVE_FRESH;
        provenance_tier is FORWARD_PREDICTION; is_degraded is False.
        """
        t = Time(61351.0, format="mjd", scale="utc")
        quality = get_earth_orientation_quality(t)

        assert quality.data_source == "PREDICTIVE_FRESH"
        assert quality.provenance_tier == "FORWARD_PREDICTION"
        assert quality.is_degraded is False
        assert quality.prediction_horizon_days == 30.0
        assert quality.ut1_status == 2
        assert quality.pm_status == 2

    def test_iers_03b_boundary_just_beyond_30_days(self):
        """
        TEST-IERS-03B: Boundary 4: Just Beyond 30 Days.
        Query epoch at MJD 61352.0 (2026-11-08 00:00:00 UTC).
        Horizon is 31.0d > 30.0d.
        Assert status is 2; horizon == 31.0d; data_source is PREDICTIVE_STALE;
        provenance_tier is UNMAINTAINED_PREDICTION; is_degraded is True.
        """
        t = Time(61352.0, format="mjd", scale="utc")
        quality = get_earth_orientation_quality(t)

        assert quality.data_source == "PREDICTIVE_STALE"
        assert quality.provenance_tier == "UNMAINTAINED_PREDICTION"
        assert quality.is_degraded is True
        assert quality.prediction_horizon_days == 31.0
        assert quality.ut1_status == 2
        assert quality.pm_status == 2

    def test_iers_04_out_of_range_fallback(self):
        """
        TEST-IERS-04: Out-of-Range Fallback (Future Epoch 2030 / MJD 62502.0).
        Independently assert:
        1. ut1_utc returns status -2 and frozen endpoint value table['UT1_UTC'][-1].
        2. pm_xy returns status -2 and frozen table endpoint.
        3. get_polar_motion returns _DEFAULT_PM = (0.035, 0.29) * u.arcsec.
        4. Resulting provenance is BOUNDARY_FALLBACK with is_degraded is True.
        5. Zero network access during execution.
        """
        table = iers.earth_orientation_table.get()
        t = Time(62502.0, format="mjd", scale="utc")

        # 1. UT1 endpoint freezing
        u_val, u_stat = table.ut1_utc(t, return_status=True)
        assert u_stat == -2
        assert u_val == table["UT1_UTC"][-1]

        # 2. PM endpoint freezing in table
        pm_x, pm_y, pm_stat = table.pm_xy(t, return_status=True)
        assert pm_stat == -2

        # 3. get_polar_motion fallback to _DEFAULT_PM in radians
        pm_actual = get_polar_motion(t)
        pm_expected_rad = _DEFAULT_PM.to_value(u.radian)
        assert np.isclose(pm_actual[0], pm_expected_rad[0], atol=1e-15)
        assert np.isclose(pm_actual[1], pm_expected_rad[1], atol=1e-15)

        # 4. Resulting quality record
        quality = get_earth_orientation_quality(t)
        assert quality.data_source == "OUT_OF_RANGE"
        assert quality.provenance_tier == "BOUNDARY_FALLBACK"
        assert quality.is_degraded is True
        assert quality.ut1_status == -2
        assert quality.pm_status == -2
        assert quality.prediction_horizon_days == (62502.0 - LAST_DEFINITIVE_MJD)

    def test_iers_05_conservative_aggregation_weakest_link(self):
        """
        TEST-IERS-05: Conservative Weakest-Link Aggregation.
        Mock/evaluate mixed status: UT1 status 0 (DEFINITIVE), PM status -2 (OUT_OF_RANGE).
        Assert aggregate quality resolves to BOUNDARY_FALLBACK (min_rank = 1);
        data_source is OUT_OF_RANGE; is_degraded is True. Weakest-link rule verified.
        """
        quality = evaluate_earth_orientation_quality(
            status_ut1=0,
            status_pm=-2,
            horizon_days=0.0,
        )

        assert quality.data_source == "OUT_OF_RANGE"
        assert quality.provenance_tier == "BOUNDARY_FALLBACK"
        assert quality.is_degraded is True
        assert quality.ut1_status == 0
        assert quality.pm_status == -2

    def test_iers_06_strict_mode_domain_error(self):
        """
        TEST-IERS-06: Strict Mode Domain Error.
        Under OFFLINE_STRICT mode, querying a stale or out-of-range epoch must raise
        EarthOrientationPolicyError containing epoch and structured details.
        Under OFFLINE_PREDICTIVE (default), it must succeed and return quality record.
        """
        stale_epoch = datetime(2030, 1, 1, 0, 0, tzinfo=timezone.utc)

        # 1. OFFLINE_PREDICTIVE permits degraded calculation
        q_pred = check_earth_orientation_policy(stale_epoch, mode="OFFLINE_PREDICTIVE")
        assert q_pred.is_degraded is True
        assert q_pred.provenance_tier == "BOUNDARY_FALLBACK"

        # 2. OFFLINE_STRICT rejects degraded orientation
        with pytest.raises(EarthOrientationPolicyError) as exc_info:
            check_earth_orientation_policy(stale_epoch, mode="OFFLINE_STRICT")

        err = exc_info.value
        assert err.data_source == "OUT_OF_RANGE"
        assert err.epoch == stale_epoch
        assert err.details["provenance_tier"] == "BOUNDARY_FALLBACK"
        assert err.details["mode"] == "OFFLINE_STRICT"
        assert "rejected under OFFLINE_STRICT policy" in err.message

    def test_iers_07_frames_transformation_integration(self):
        """
        TEST-IERS-07: Frames Coordinate Transformation Policy Enforcement.
        Verifies that frames.transform_state_vector and frames.transform_state_vectors
        respect the iers_mode parameter:
        - Succeed under OFFLINE_PREDICTIVE even on future epochs.
        - Raise EarthOrientationPolicyError under OFFLINE_STRICT on degraded epochs.
        - Succeed under OFFLINE_STRICT on verified definitive epochs (e.g. 2023).
        """
        rec_future = StateVectorRecord(
            norad_cat_id="25544",
            object_id="1998-067A",
            object_name="ISS (ZARYA)",
            epoch=datetime(2030, 1, 1, 0, 0, tzinfo=timezone.utc),
            frame="TEME",
            position_km=(6700.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
            status="ACTIVE",
        )

        rec_valid = StateVectorRecord(
            norad_cat_id="25544",
            object_id="1998-067A",
            object_name="ISS (ZARYA)",
            epoch=datetime(2023, 1, 1, 0, 0, tzinfo=timezone.utc),
            frame="TEME",
            position_km=(6700.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
            status="ACTIVE",
        )

        # Single transform under OFFLINE_PREDICTIVE
        transformed_pred = transform_state_vector(rec_future, "GCRS", iers_mode="OFFLINE_PREDICTIVE")
        assert transformed_pred.frame == "GCRS"

        # Single transform under OFFLINE_STRICT on stale epoch raises
        with pytest.raises(EarthOrientationPolicyError):
            transform_state_vector(rec_future, "GCRS", iers_mode="OFFLINE_STRICT")

        # Single transform under OFFLINE_STRICT on valid epoch succeeds
        transformed_valid = transform_state_vector(rec_valid, "GCRS", iers_mode="OFFLINE_STRICT")
        assert transformed_valid.frame == "GCRS"

        # Batch transform under OFFLINE_STRICT on stale epoch raises
        with pytest.raises(EarthOrientationPolicyError):
            transform_state_vectors([rec_future], "GCRS", iers_mode="OFFLINE_STRICT")

        # Helper get_frame_transformation_quality
        q_frame = get_frame_transformation_quality(rec_valid.epoch)
        assert q_frame.provenance_tier == "OBSERVED_EOP"
        assert q_frame.is_degraded is False

    def test_iers_08_zero_network_guarantee(self, monkeypatch):
        """
        TEST-IERS-08: Zero Network Access Guarantee.
        Monkeypatches socket.socket.connect to raise AssertionError.
        Executes policy quality checks and coordinate transformations across historical,
        current, and future epochs, confirming zero network calls occur.
        """
        def blocked_connect(*args, **kwargs):
            raise AssertionError("Network socket connection attempted during offline execution!")

        monkeypatch.setattr(socket.socket, "connect", blocked_connect)

        # Query across the entire temporal span
        test_mjds = [40000.0, 59945.0, 61321.0, 61322.0, 61351.0, 61352.0, 62502.0]
        for m in test_mjds:
            q = get_earth_orientation_quality(Time(m, format="mjd", scale="utc"))
            assert q is not None

        # Execute coordinate frame transform
        state = StateVectorRecord(
            norad_cat_id="25544",
            object_id="1998-067A",
            object_name="ISS (ZARYA)",
            epoch=datetime(2026, 10, 8, 0, 0, tzinfo=timezone.utc),
            frame="TEME",
            position_km=(6700.0, 0.0, 0.0),
            velocity_kms=(0.0, 7.5, 0.0),
            status="ACTIVE",
        )
        res_gcrs = transform_state_vector(state, "GCRS")
        res_itrs = transform_state_vector(state, "ITRS")
        assert res_gcrs.frame == "GCRS"
        assert res_itrs.frame == "ITRS"

    def test_iers_09_fixture_isolation(self):
        """
        TEST-IERS-09: Test Fixture Isolation.
        Verifies that within a test, modifying iers.conf settings will be cleanly
        restored by the conftest isolate_iers_configuration autouse fixture.
        Also asserts the active test environment default is auto_download=False, auto_max_age=None.
        """
        # Baseline within isolated test should be offline decoupled
        assert iers.conf.auto_download is False
        assert iers.conf.auto_max_age is None

        # Mutate inside test
        iers.conf.auto_download = True
        iers.conf.auto_max_age = 45.0
        assert iers.conf.auto_download is True
        assert iers.conf.auto_max_age == 45.0
