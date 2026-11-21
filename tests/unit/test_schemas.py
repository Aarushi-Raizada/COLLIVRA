"""
Unit tests for orbital_core.schemas (Pydantic v2 data contracts).

Validates:
- Real OMM fixture ingestion (ISS, CSS Tianhe, Starlink, Cosmos-2251 debris).
- String preservation of NORAD catalog IDs.
- Synthetic fragment distinction.
- Required fields and validation failures.
- Physical bounds, orbital element validation, and high-eccentricity orbits (e = 0.95).
- Derived mean two-body astrodynamic approximations (semi-major axis, period, periapsis/apoapsis).
- Heuristic risk scoring schema and scientific disclaimers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from orbital_core.schemas import (
    HEURISTIC_RISK_DISCLAIMER,
    HeuristicRiskScore,
    OrbitalObjectRecord,
    StateVectorRecord,
)
from pydantic import ValidationError

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "data" / "fixtures"


class TestOrbitalObjectRecordParsing:
    def test_iss_fixture_parsing(self, stations_fixture: list[dict]):
        iss_raw = stations_fixture[0]
        record = OrbitalObjectRecord.from_omm_dict(iss_raw, data_source="OFFLINE_FIXTURE")

        assert record.norad_cat_id == "25544"
        assert isinstance(record.norad_cat_id, str)
        assert record.object_name == "ISS (ZARYA)"
        assert record.object_id == "1998-067A"
        assert record.data_source == "OFFLINE_FIXTURE"
        assert record.is_synthetic is False
        assert record.epoch.tzinfo == timezone.utc

        # Astrodynamics bounds for ISS LEO orbit
        assert 6700.0 < record.semi_major_axis_km < 6900.0
        assert 90.0 < record.period_minutes < 95.0
        assert 400.0 < record.periapsis_altitude_km < 440.0
        assert 400.0 < record.apoapsis_altitude_km < 440.0
        assert record.eccentricity < 0.005
        assert 51.5 < record.inclination < 51.8

    def test_tiangong_fixture_parsing(self, stations_fixture: list[dict]):
        css_raw = stations_fixture[1]
        record = OrbitalObjectRecord.from_omm_dict(css_raw)

        assert record.norad_cat_id == "48274"
        assert isinstance(record.norad_cat_id, str)
        assert record.object_name == "CSS (TIANHE)"
        assert 6700.0 < record.semi_major_axis_km < 6900.0
        assert 41.0 < record.inclination < 42.0

    def test_starlink_fixture_batch(self, starlink_fixture: list[dict]):
        assert len(starlink_fixture) == 5
        records = [OrbitalObjectRecord.from_omm_dict(item) for item in starlink_fixture]
        for rec in records:
            assert isinstance(rec.norad_cat_id, str)
            assert rec.object_name.startswith("STARLINK")
            assert 53.0 < rec.inclination < 53.5
            assert rec.is_synthetic is False
            assert rec.semi_major_axis_km > 6500.0

    def test_debris_fixture_batch(self, debris_fixture: list[dict]):
        assert len(debris_fixture) == 5
        records = [OrbitalObjectRecord.from_omm_dict(item) for item in debris_fixture]
        cosmos_parent = records[0]
        assert cosmos_parent.norad_cat_id == "22675"
        assert cosmos_parent.object_name == "COSMOS 2251"
        assert 74.0 < cosmos_parent.inclination < 74.1


class TestIdentifierAndSyntheticDistinction:
    def test_string_coercion_from_int(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["NORAD_CAT_ID"] = 25544  # integer
        record = OrbitalObjectRecord.from_omm_dict(raw)
        assert record.norad_cat_id == "25544"
        assert isinstance(record.norad_cat_id, str)

    def test_synthetic_identifier_preservation(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["NORAD_CAT_ID"] = "SYNTH-FRAG-042-001"
        raw["OBJECT_NAME"] = "SYNTHETIC DEBRIS 001"
        record = OrbitalObjectRecord.from_omm_dict(raw, is_synthetic=True)
        assert record.norad_cat_id == "SYNTH-FRAG-042-001"
        assert record.is_synthetic is True

    def test_empty_norad_cat_id_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["NORAD_CAT_ID"] = "   "
        with pytest.raises(ValidationError):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_none_norad_cat_id_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["NORAD_CAT_ID"] = None
        with pytest.raises((ValueError, ValidationError)):
            OrbitalObjectRecord.from_omm_dict(raw)


class TestValidationAndPhysicalBounds:
    def test_valid_high_eccentricity_orbit(self, stations_fixture: list[dict]):
        """Valid highly eccentric orbit (e.g. Molniya / GTO, e = 0.95)."""
        raw = stations_fixture[0].copy()
        raw["ECCENTRICITY"] = 0.95
        raw["MEAN_MOTION"] = 2.006  # ~12-hour period (Molniya)
        record = OrbitalObjectRecord.from_omm_dict(raw)

        assert record.eccentricity == 0.95
        assert record.semi_major_axis_km > 20000.0
        # Periapsis altitude hp = a*(1-0.95) - 6378.137 km
        assert record.periapsis_altitude_km < record.apoapsis_altitude_km
        assert isinstance(record.semi_major_axis_km, float)

    def test_negative_mean_motion_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["MEAN_MOTION"] = -15.5
        with pytest.raises(ValidationError, match="mean_motion must be strictly positive"):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_zero_mean_motion_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["MEAN_MOTION"] = 0.0
        with pytest.raises(ValidationError, match="mean_motion must be strictly positive"):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_negative_eccentricity_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["ECCENTRICITY"] = -0.05
        with pytest.raises(ValidationError, match="eccentricity must be in range"):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_hyperbolic_eccentricity_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["ECCENTRICITY"] = 1.05
        with pytest.raises(ValidationError, match="eccentricity must be in range"):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_parabolic_eccentricity_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["ECCENTRICITY"] = 1.0
        with pytest.raises(ValidationError, match="eccentricity must be in range"):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_invalid_inclination_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["INCLINATION"] = 185.0
        with pytest.raises(ValidationError, match="inclination must be between"):
            OrbitalObjectRecord.from_omm_dict(raw)

        raw["INCLINATION"] = -2.0
        with pytest.raises(ValidationError, match="inclination must be between"):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_invalid_angular_element_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["RA_OF_ASC_NODE"] = 365.0
        with pytest.raises(ValidationError, match="Angular orbital element must be in range"):
            OrbitalObjectRecord.from_omm_dict(raw)

    def test_missing_required_epoch_raises(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        del raw["EPOCH"]
        with pytest.raises((ValueError, ValidationError)):
            OrbitalObjectRecord.from_omm_dict(raw)


class TestTemporalAndDerivedProperties:
    def test_epoch_timezone_normalization(self, stations_fixture: list[dict]):
        raw = stations_fixture[0].copy()
        raw["EPOCH"] = "2026-11-02T12:00:00"  # naive string
        rec = OrbitalObjectRecord.from_omm_dict(raw)
        assert rec.epoch.tzinfo == timezone.utc

        raw["EPOCH"] = "2026-11-02T12:00:00Z"
        rec = OrbitalObjectRecord.from_omm_dict(raw)
        assert rec.epoch.tzinfo == timezone.utc

    def test_raw_omm_preservation(self, stations_fixture: list[dict]):
        raw = stations_fixture[0]
        rec = OrbitalObjectRecord.from_omm_dict(raw)
        assert rec.raw_omm["BSTAR"] == raw["BSTAR"]
        assert rec.raw_omm["REV_AT_EPOCH"] == raw["REV_AT_EPOCH"]
        assert rec.raw_omm["OBJECT_NAME"] == raw["OBJECT_NAME"]


class TestComplementaryContracts:
    def test_state_vector_record(self):
        sv = StateVectorRecord(
            norad_cat_id="25544",
            epoch=datetime.now(timezone.utc),
            frame="GCRF",
            position_km=(1000.0, 2000.0, 6000.0),
            velocity_kms=(-5.0, 4.0, 1.0),
        )
        assert sv.frame == "GCRF"
        assert len(sv.position_km) == 3

    def test_heuristic_risk_score_and_disclaimer(self):
        risk = HeuristicRiskScore(
            score=0.85,
            miss_distance_km=0.15,
            relative_speed_kms=14.2,
            breakdown={"miss_penalty": 0.5, "velocity_penalty": 0.35},
        )
        assert risk.score == 0.85
        assert risk.disclaimer == HEURISTIC_RISK_DISCLAIMER
        assert "Scientific Disclaimer" in risk.disclaimer
        assert "formal probability of collision" in risk.disclaimer

    def test_heuristic_risk_score_range_validation(self):
        with pytest.raises(ValidationError):
            HeuristicRiskScore(
                score=1.5,  # out of bounds [0.0, 1.0]
                miss_distance_km=0.5,
                relative_speed_kms=10.0,
            )
