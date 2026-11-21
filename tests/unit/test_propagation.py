"""
Unit tests for orbital_core.propagation (SGP4 orbital propagation engine).

Tests:
1. Propagation of ISS using authentic offline OMM fixture.
2. Propagation of CSS Tianhe using fixture.
3. Correct TEME frame labeling.
4. Correct position and velocity units (km, km/s).
5. UTC timestamp handling (aware, offsets, naive rejection).
6. Propagation over time ranges (propagate_range).
7. Invalid OMM data handling.
8. Invalid timestamps and step sizes.
9. SGP4 propagation errors (decayed orbit, error code 6).
10. Preservation of NORAD IDs as strings.
11. Synthetic objects without NORAD IDs.
12. Deterministic results for identical inputs.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest
from orbital_core.propagation import (
    PropagationError,
    SGP4PropagationError,
    propagate_orbit,
    propagate_range,
    propagate_satrec,
    record_to_satrec,
)
from orbital_core.schemas import OrbitalObjectRecord, StateVectorRecord
from sgp4.api import WGS72, Satrec


class TestSGP4PropagationBasics:
    def test_iss_propagation_at_epoch(self, stations_fixture: list[dict]):
        """Propagate ISS at its exact OMM epoch and verify against analytical SGP4 state."""
        iss_raw = stations_fixture[0]
        record = OrbitalObjectRecord.from_omm_dict(iss_raw)
        epoch = record.epoch

        sv = propagate_orbit(record, epoch)

        assert sv.frame == "TEME"
        assert sv.norad_cat_id == "25544"
        assert isinstance(sv.norad_cat_id, str)
        assert sv.object_name == "ISS (ZARYA)"
        assert sv.status == "OK"
        assert sv.sgp4_error_code == 0
        assert sv.epoch == epoch

        # Position units: kilometers; Velocity units: km/s
        # ISS is in LEO at ~415 km altitude -> radius ~6793 km
        radius = sv.radius_km
        speed = sv.speed_kms

        assert 6770.0 < radius < 6810.0
        assert 7.60 < speed < 7.75

        # Precise numerical verification against SGP4 analytical baseline
        # r = (6349.552, -2416.035, 0.006) km
        # v = (1.687, 4.447, 6.012) km/s
        assert abs(sv.x - 6349.552) < 0.01
        assert abs(sv.y - (-2416.035)) < 0.01
        assert abs(sv.z - 0.006) < 0.01
        assert abs(sv.vx - 1.687) < 0.01
        assert abs(sv.vy - 4.447) < 0.01
        assert abs(sv.vz - 6.012) < 0.01

    def test_tiangong_propagation_future(self, stations_fixture: list[dict]):
        """Propagate CSS Tianhe 90 minutes into the future (approx 1 orbital revolution)."""
        css_raw = stations_fixture[1]
        record = OrbitalObjectRecord.from_omm_dict(css_raw)
        future_time = record.epoch + timedelta(minutes=90)

        sv = propagate_orbit(record, future_time)

        assert sv.frame == "TEME"
        assert sv.norad_cat_id == "48274"
        assert sv.object_name == "CSS (TIANHE)"
        assert sv.status == "OK"
        assert sv.sgp4_error_code == 0

        # CSS LEO orbit bounds
        assert 6750.0 < sv.radius_km < 6820.0
        assert 7.65 < sv.speed_kms < 7.75

    def test_starlink_propagation(self, starlink_fixture: list[dict]):
        """Propagate Starlink sample satellite and verify LEO characteristics."""
        starlink_raw = starlink_fixture[0]
        record = OrbitalObjectRecord.from_omm_dict(starlink_raw)
        sv = propagate_orbit(record, record.epoch)

        assert sv.frame == "TEME"
        assert sv.norad_cat_id == "53541"
        assert sv.object_name.startswith("STARLINK")
        assert 6800.0 < sv.radius_km < 7000.0
        assert 7.50 < sv.speed_kms < 7.65


class TestFrameAndUnitIntegrity:
    def test_frame_labeling_strictly_teme(self, stations_fixture: list[dict]):
        """Verify SGP4 output is strictly labeled TEME per AGENTS.md §3.1."""
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        sv = propagate_orbit(record, record.epoch)

        assert sv.frame == "TEME"
        assert sv.frame != "GCRF"
        assert sv.frame != "ITRF"

    def test_position_and_velocity_units(self, stations_fixture: list[dict]):
        """Verify magnitudes reflect standard aerospace units (km and km/s)."""
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        sv = propagate_orbit(record, record.epoch)

        # Earth radius is ~6378 km; LEO orbit radius cannot be in meters (~6.8e6)
        assert 6000.0 < sv.radius_km < 7500.0
        # Velocity in km/s (~7.6 km/s); cannot be in m/s (~7600)
        assert 7.0 < sv.speed_kms < 8.0


class TestTimeHandling:
    def test_timezone_aware_utc_accepted(self, stations_fixture: list[dict]):
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        aware_utc = datetime(2026, 11, 2, 0, 0, 0, tzinfo=timezone.utc)
        sv = propagate_orbit(record, aware_utc)
        assert sv.epoch == aware_utc

    def test_timezone_offset_normalized_to_utc(self, stations_fixture: list[dict]):
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        # UTC+05:30 offset
        tz_offset = timezone(timedelta(hours=5, minutes=30))
        local_time = datetime(2026, 11, 2, 5, 30, 0, tzinfo=tz_offset)
        sv = propagate_orbit(record, local_time)

        # Expected UTC is 2026-11-02 00:00:00Z
        expected_utc = datetime(2026, 11, 2, 0, 0, 0, tzinfo=timezone.utc)
        assert sv.epoch == expected_utc

    def test_naive_datetime_rejected(self, stations_fixture: list[dict]):
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        naive_dt = datetime(2026, 11, 2, 0, 0, 0)  # No tzinfo

        with pytest.raises(ValueError, match="explicit timezone.*required"):
            propagate_orbit(record, naive_dt)

    def test_iso_string_with_z_accepted(self, stations_fixture: list[dict]):
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        sv = propagate_orbit(record, "2026-11-02T00:00:00Z")
        assert sv.epoch.tzinfo == timezone.utc

    def test_backward_propagation_from_epoch(self, stations_fixture: list[dict]):
        """
        Verify backward analytical propagation (t_epoch - 60 min).
        SGP4 analytically evaluates negative delta-t without stability breakdown.
        """
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        past_time = record.epoch - timedelta(minutes=60)
        sv = propagate_orbit(record, past_time)

        assert sv.frame == "TEME"
        assert sv.status == "OK"
        assert sv.sgp4_error_code == 0
        assert sv.epoch == past_time
        # ISS LEO orbit bounds remain valid in backward propagation
        assert 6770.0 < sv.radius_km < 6810.0
        assert 7.60 < sv.speed_kms < 7.75


class TestPropagationRange:
    def test_propagate_range_success(self, stations_fixture: list[dict]):
        """Propagate over 30 minutes in 5-minute steps (7 points: 0, 5, 10, 15, 20, 25, 30)."""
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start_time = record.epoch
        end_time = start_time + timedelta(minutes=30)
        step_seconds = 300.0

        records = propagate_range(record, start_time, end_time, step_seconds=step_seconds)

        assert len(records) == 7
        assert records[0].epoch == start_time
        assert records[-1].epoch == end_time

        # Verify sequential spacing of 300 seconds
        for i in range(len(records) - 1):
            dt_diff = (records[i + 1].epoch - records[i].epoch).total_seconds()
            assert math.isclose(dt_diff, 300.0, rel_tol=1e-6)
            assert records[i].frame == "TEME"
            assert records[i].status == "OK"

    def test_invalid_step_seconds_raises(self, stations_fixture: list[dict]):
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        with pytest.raises(ValueError, match="step_seconds must be strictly positive"):
            propagate_range(
                record, record.epoch, record.epoch + timedelta(hours=1), step_seconds=0.0
            )

        with pytest.raises(ValueError, match="step_seconds must be strictly positive"):
            propagate_range(
                record, record.epoch, record.epoch + timedelta(hours=1), step_seconds=-60.0
            )

    def test_end_before_start_raises(self, stations_fixture: list[dict]):
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start = record.epoch
        end = start - timedelta(hours=1)

        with pytest.raises(ValueError, match="end_time.*must be >= start_time"):
            propagate_range(record, start, end, step_seconds=60.0)

    def test_propagate_range_single_point(self, stations_fixture: list[dict]):
        """When start_time == end_time, propagate_range returns exactly 1 StateVectorRecord."""
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        epoch = record.epoch

        records = propagate_range(record, epoch, epoch, step_seconds=60.0)

        assert len(records) == 1
        assert records[0].epoch == epoch
        assert records[0].frame == "TEME"
        assert records[0].status == "OK"
        assert records[0].norad_cat_id == "25544"

    def test_propagate_range_non_integer_window(self, stations_fixture: list[dict]):
        """
        A 500-second window with 300-second step size must include samples at
        t = 0s, t = 300s, and t = 500s (boundary inclusion).
        """
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        start_time = record.epoch
        end_time = start_time + timedelta(seconds=500)
        step_seconds = 300.0

        records = propagate_range(record, start_time, end_time, step_seconds=step_seconds)

        assert len(records) == 3
        assert records[0].epoch == start_time
        assert records[1].epoch == start_time + timedelta(seconds=300)
        assert records[2].epoch == end_time

        # Verify time deltas
        assert (records[1].epoch - records[0].epoch).total_seconds() == 300.0
        assert (records[2].epoch - records[0].epoch).total_seconds() == 500.0
        for rec in records:
            assert rec.frame == "TEME"
            assert rec.status == "OK"

    def test_reversed_range_with_iso_strings(self, stations_fixture: list[dict]):
        """ISO strings where end_time < start_time must raise ValueError."""
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        with pytest.raises(ValueError, match="end_time.*must be >= start_time"):
            propagate_range(
                record,
                "2026-11-02T12:00:00Z",
                "2026-11-02T11:00:00Z",
                step_seconds=60.0,
            )


class TestErrorHandlingAndEdgeCases:
    def test_sgp4_decay_error_code(self, stations_fixture: list[dict]):
        """
        Propagating ISS to the distant future (year 2045) triggers decay (error code 6).
        Tests that raise_on_error=False records the error status gracefully.
        """
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        future_decay_time = datetime(2045, 1, 1, 0, 0, 0, tzinfo=timezone.utc)

        sv = propagate_orbit(record, future_decay_time, raise_on_error=False)

        assert sv.sgp4_error_code == 6
        assert "decayed" in sv.status.lower()

    def test_sgp4_decay_raises_when_requested(self, stations_fixture: list[dict]):
        """Verify SGP4PropagationError is raised when raise_on_error=True."""
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        future_decay_time = datetime(2045, 1, 1, 0, 0, 0, tzinfo=timezone.utc)

        with pytest.raises(SGP4PropagationError) as exc_info:
            propagate_orbit(record, future_decay_time, raise_on_error=True)

        assert exc_info.value.error_code == 6
        assert exc_info.value.epoch == future_decay_time

    def test_invalid_omm_dict_missing_fields(self):
        """Missing required OMM fields raises PropagationError."""
        incomplete_omm = {
            "OBJECT_NAME": "BROKEN SAT",
            "NORAD_CAT_ID": 12345,
            # Missing EPOCH, MEAN_MOTION, etc.
        }
        with pytest.raises(PropagationError):
            record_to_satrec(incomplete_omm)

    def test_synthetic_cartesian_fragment_rejected(self, stations_fixture: list[dict]):
        """
        Feeding a synthetic fragment without integer NORAD ID into SGP4 raises PropagationError.
        Enforces AGENTS.md §3.3: synthetic Cartesian states must not be fed to SGP4.
        """
        raw = stations_fixture[0].copy()
        raw["NORAD_CAT_ID"] = "SYNTH-FRAG-042-001"
        synth_record = OrbitalObjectRecord.from_omm_dict(raw, is_synthetic=True)

        with pytest.raises(
            PropagationError, match="Cannot initialize SGP4 directly from synthetic"
        ):
            record_to_satrec(synth_record)


class TestSyntheticStateVectorRepresentation:
    def test_synthetic_state_vector_without_norad_id(self):
        """Synthetic objects can be represented in StateVectorRecord without a fake NORAD ID."""
        sv = StateVectorRecord(
            object_id="SYNTH-FRAG-042-001",
            object_name="FRAGMENT 001",
            epoch=datetime.now(timezone.utc),
            frame="TEME",
            position_km=(1500.0, -2500.0, 6200.0),
            velocity_kms=(-5.2, 4.1, 1.3),
        )

        assert sv.object_id == "SYNTH-FRAG-042-001"
        assert sv.norad_cat_id is None
        assert sv.object_name == "FRAGMENT 001"
        assert sv.status == "OK"


class TestDeterminism:
    def test_identical_inputs_produce_identical_states(self, stations_fixture: list[dict]):
        """Identical inputs must yield bitwise identical floating-point results."""
        record = OrbitalObjectRecord.from_omm_dict(stations_fixture[0])
        t = record.epoch + timedelta(minutes=45)

        sv1 = propagate_orbit(record, t)
        sv2 = propagate_orbit(record, t)

        assert sv1.position_km == sv2.position_km
        assert sv1.velocity_kms == sv2.velocity_kms
        assert sv1.sgp4_error_code == sv2.sgp4_error_code


class TestValladoBenchmark:
    """
    Verification against the published David Vallado SGP4 benchmark dataset
    (AIAA-2006-6753), bundled in python sgp4 test suite (SGP4-VER.TLE / tcppver.out).

    Target satellite: Vanguard 2 (NORAD ID 5).
    Published reference state vectors under WGS-72:
    - At t = 0 min (epoch):
        Position (km): [7022.465293, -1400.082968, 0.039952]
        Velocity (km/s): [1.893841, 6.405894, 4.534807]
    - At t = 360 min (+6 hours):
        Position (km): [-7154.031202, -3783.176825, -3536.194123]
        Velocity (km/s): [4.741887, -4.151818, -2.093935]
    """

    # Published 2-line element set for Satellite 5 from SGP4-VER.TLE
    VANGUARD2_LINE1 = "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753"
    VANGUARD2_LINE2 = "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667"

    # Epoch: 2000-06-27T18:50:19.733568Z (Year 2000, Day 179.78495062)
    VANGUARD2_EPOCH = datetime(2000, 1, 1, 0, 0, 0, tzinfo=timezone.utc) + timedelta(
        days=179.78495062 - 1.0
    )

    REF_R0 = (7022.465293, -1400.082968, 0.039952)
    REF_V0 = (1.893841, 6.405894, 4.534807)
    REF_R360 = (-7154.031202, -3783.176825, -3536.194123)
    REF_V360 = (4.741887, -4.151818, -2.093935)

    def test_vallado_vanguard2_twoline2rv_benchmark(self):
        """
        Propagate Vanguard 2 initialized via Satrec.twoline2rv (WGS-72)
        and compare against published AIAA-2006-6753 / tcppver.out baseline.
        """
        sat = Satrec.twoline2rv(self.VANGUARD2_LINE1, self.VANGUARD2_LINE2, WGS72)

        # 1. At t = 0 min
        sv0 = propagate_satrec(sat, self.VANGUARD2_EPOCH)
        assert sv0.frame == "TEME"
        assert sv0.status == "OK"
        assert sv0.sgp4_error_code == 0

        # Sub-millimeter position agreement (< 1e-4 km = 10 cm tolerance)
        assert abs(sv0.x - self.REF_R0[0]) < 1e-4
        assert abs(sv0.y - self.REF_R0[1]) < 1e-4
        assert abs(sv0.z - self.REF_R0[2]) < 1e-4

        # Sub-millimeter/s velocity agreement (< 1e-5 km/s = 1 cm/s tolerance)
        assert abs(sv0.vx - self.REF_V0[0]) < 1e-5
        assert abs(sv0.vy - self.REF_V0[1]) < 1e-5
        assert abs(sv0.vz - self.REF_V0[2]) < 1e-5

        # 2. At t = 360 min
        t360 = self.VANGUARD2_EPOCH + timedelta(minutes=360)
        sv360 = propagate_satrec(sat, t360)
        assert sv360.frame == "TEME"
        assert sv360.status == "OK"
        assert sv360.sgp4_error_code == 0

        assert abs(sv360.x - self.REF_R360[0]) < 1e-4
        assert abs(sv360.y - self.REF_R360[1]) < 1e-4
        assert abs(sv360.z - self.REF_R360[2]) < 1e-4

        assert abs(sv360.vx - self.REF_V360[0]) < 1e-5
        assert abs(sv360.vy - self.REF_V360[1]) < 1e-5
        assert abs(sv360.vz - self.REF_V360[2]) < 1e-5

    def test_vallado_vanguard2_range_benchmark(self):
        """
        Verify propagate_range produces the identical benchmark states
        across the 360-minute window.
        """
        sat = Satrec.twoline2rv(self.VANGUARD2_LINE1, self.VANGUARD2_LINE2, WGS72)
        t360 = self.VANGUARD2_EPOCH + timedelta(minutes=360)

        records = propagate_range(sat, self.VANGUARD2_EPOCH, t360, step_seconds=360 * 60.0)

        assert len(records) == 2
        # Start matches ref_r0
        assert abs(records[0].x - self.REF_R0[0]) < 1e-4
        assert abs(records[0].vx - self.REF_V0[0]) < 1e-5
        # End matches ref_r360
        assert abs(records[1].x - self.REF_R360[0]) < 1e-4
        assert abs(records[1].vx - self.REF_V360[0]) < 1e-5

    def test_vallado_vanguard2_omm_mapping_benchmark(self):
        """
        Verify that mapping Vanguard 2 TLE orbital elements into an OMM dictionary
        propagated via propagate_orbit matches the published Vallado reference values.
        """
        omm_vanguard = {
            "OBJECT_NAME": "VANGUARD 2",
            "OBJECT_ID": "1958-002B",
            "EPOCH": "2000-06-27T18:50:19.733568Z",
            "MEAN_MOTION": 10.82419157413667,
            "ECCENTRICITY": 0.1859667,
            "INCLINATION": 34.2682,
            "RA_OF_ASC_NODE": 348.7242,
            "ARG_OF_PERICENTER": 331.7664,
            "MEAN_ANOMALY": 19.3264,
            "EPHEMERIS_TYPE": 0,
            "CLASSIFICATION_TYPE": "U",
            "NORAD_CAT_ID": 5,
            "ELEMENT_SET_NO": 999,
            "REV_AT_EPOCH": 4136,
            "BSTAR": 0.000028098,
            "MEAN_MOTION_DOT": 0.00000023,
            "MEAN_MOTION_DDOT": 0.0,
        }

        sv0 = propagate_orbit(omm_vanguard, self.VANGUARD2_EPOCH)
        assert abs(sv0.x - self.REF_R0[0]) < 1e-4
        assert abs(sv0.y - self.REF_R0[1]) < 1e-4
        assert abs(sv0.z - self.REF_R0[2]) < 1e-4
        assert abs(sv0.vx - self.REF_V0[0]) < 1e-5
        assert abs(sv0.vy - self.REF_V0[1]) < 1e-5
        assert abs(sv0.vz - self.REF_V0[2]) < 1e-5
