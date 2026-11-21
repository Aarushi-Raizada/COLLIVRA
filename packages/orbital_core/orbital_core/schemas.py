
"""
Pydantic v2 schemas and data contracts for ZORBIT orbital objects and ephemerides.

Follows NASA / CelesTrak OMM (Orbit Mean-Elements Message) standards,
enforces strict units (km, km/s, rev/day, degrees, UTC), preserves string
identifiers for NORAD IDs, and enforces scientific guardrails from AGENTS.md.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator


def normalize_datetime_utc(value: Any, field_name: str = "Datetime") -> datetime:
    """
    Ensure datetime is timezone-aware (accepting any valid UTC offset) and normalize to UTC.
    Rejects naive datetimes without timezone offset.
    """
    if isinstance(value, str):
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    elif isinstance(value, datetime):
        dt = value
    else:
        raise ValueError(f"Unsupported {field_name} format: {type(value)}")

    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError(f"{field_name} must be timezone-aware.")
    return dt.astimezone(timezone.utc)


# Standard Astrodynamical Constants
# Note on Ellipsoid Standards:
# ZORBIT standardizes on WGS-84 for geometric altitude references and Earth representation.
# - WGS-84: mu = 398600.4418 km^3/s^2, R_earth = 6378.137 km
# - SGP4 Internal Engine: Historically operates with WGS-72 (mu = 398600.8 km^3/s^2,
#   R_earth = 6378.135 km). The resulting difference in derived semi-major axis is ~2 meters
#   at LEO (~0.0001%), which is well within standard TLE observational fitting uncertainty.
EARTH_MU_KM3_S2: float = 398600.4418  # WGS-84 Earth gravitational parameter (km^3 / s^2)
EARTH_RADIUS_KM: float = 6378.137  # WGS-84 Earth equatorial radius (km)
SECONDS_PER_DAY: float = 86400.0  # Seconds in a standard solar day
MINUTES_PER_DAY: float = 1440.0  # Minutes in a standard solar day

# Scientific Disclaimer for Heuristic Risk Reporting (AGENTS.md Section 3.2)
HEURISTIC_RISK_DISCLAIMER: str = (
    "Scientific Disclaimer: Heuristic risk scores [0.0 - 1.0] are empirical "
    "screening approximations for decision-support and do NOT represent formal "
    "probability of collision (Pc). Public TLE/OMM elements do not provide "
    "calibrated covariance matrices."
)

CONJUNCTION_DISCLAIMER: str = (
    "Scientific Disclaimer: Conjunction screening results are preliminary geometric "
    "close-approach screenings derived from analytical SGP4 propagation. They do NOT "
    "represent formal probability of collision (Pc), which requires calibrated error "
    "covariance matrices. Public TLE/OMM data does not provide covariance information."
)

DataSourceType = Literal["LIVE", "CACHE", "OFFLINE_FIXTURE"]
CoordinateFrame = Literal["TEME", "GCRF", "GCRS", "ITRF", "ITRS", "RIC_LVLH"]
TrajectoryStatus = Literal["SUCCESS", "PARTIAL", "FAILED"]
TrajectoryTerminationReason = Literal[
    "COMPLETED",
    "ATMOSPHERIC_INTERFACE",
    "NUMERICAL_FAILURE",
    "INVALID_INITIAL_STATE",
]
ScreeningCategory = Literal["CRITICAL", "HIGH", "MODERATE", "LOW"]


class OrbitalObjectRecord(BaseModel):
    """
    Normalized data contract representing an orbital object derived from
    CelesTrak OMM (Orbit Mean-Elements Message) or synthetic breakup models.

    Identities are strictly strings (norad_cat_id, object_id) to support
    both standard NORAD numbers ('25544') and synthetic identifiers ('SYNTH-FRAG-001').
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    # Identifiers
    norad_cat_id: str = Field(
        ...,
        description=(
            "NORAD Catalog ID (string) or synthetic fragment ID (e.g., '25544', 'SYNTH-FRAG-001')"
        ),
    )
    object_name: str = Field(
        ...,
        description="Human-readable object name (e.g., 'ISS (ZARYA)', 'STARLINK-4303')",
    )
    object_id: str = Field(
        default="UNKNOWN",
        description="International designator / COSPAR ID (e.g., '1998-067A')",
    )
    classification_type: str = Field(
        default="U",
        description="Security classification: 'U' (Unclassified), 'C' (Confidential), 'S' (Secret)",
    )

    # Temporal Reference
    epoch: datetime = Field(
        ...,
        description="Epoch of orbital elements in UTC",
    )

    # Keplerian Mean Elements (OMM / SGP4 standard)
    mean_motion: float = Field(
        ...,
        description="Mean motion in revolutions per day (rev/day). Must be > 0.0",
    )
    eccentricity: float = Field(
        ...,
        description="Orbital eccentricity (dimensionless). Must satisfy 0.0 <= e < 1.0",
    )
    inclination: float = Field(
        ...,
        description="Orbital inclination in degrees [0.0, 180.0]",
    )
    ra_of_asc_node: float = Field(
        ...,
        description="Right Ascension of the Ascending Node (RAAN) in degrees [0.0, 360.0]",
    )
    arg_of_pericenter: float = Field(
        ...,
        description="Argument of Pericenter (perigee) in degrees [0.0, 360.0]",
    )
    mean_anomaly: float = Field(
        ...,
        description="Mean Anomaly in degrees [0.0, 360.0]",
    )

    # SGP4 Drag & Perturbation Terms
    bstar: float = Field(
        default=0.0,
        description="SGP4 aerodynamic drag parameter B* (1/Earth radii)",
    )
    mean_motion_dot: float = Field(
        default=0.0,
        description="First time derivative of mean motion (rev/day^2)",
    )
    mean_motion_ddot: float = Field(
        default=0.0,
        description="Second time derivative of mean motion (rev/day^3)",
    )
    ephemeris_type: int = Field(
        default=0,
        description="SGP4 ephemeris type (0 = standard SGP4/SDP4)",
    )
    element_set_no: int = Field(
        default=999,
        description="Element set number",
    )
    rev_at_epoch: int = Field(
        default=0,
        description="Revolution number at epoch",
    )

    # Provenance & Classification Flags
    is_synthetic: bool = Field(
        default=False,
        description="Flag distinguishing synthetic simulation objects from real catalog entries",
    )
    data_source: DataSourceType = Field(
        default="LIVE",
        description="Origin of record: LIVE, CACHE, or OFFLINE_FIXTURE",
    )
    retrieved_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp when record was ingested or parsed (UTC)",
    )
    raw_omm: dict[str, Any] = Field(
        default_factory=dict,
        description="Preserved raw CelesTrak OMM JSON metadata dictionary",
    )

    # Validators
    @field_validator("norad_cat_id", mode="before")
    @classmethod
    def validate_norad_cat_id(cls, value: Any) -> str:
        """Coerce catalog ID to string and verify non-empty."""
        if value is None:
            raise ValueError("norad_cat_id cannot be None")
        cat_str = str(value).strip()
        if not cat_str:
            raise ValueError("norad_cat_id cannot be empty")
        return cat_str

    @field_validator("object_name", mode="before")
    @classmethod
    def validate_object_name(cls, value: Any) -> str:
        """Ensure object name is non-empty string."""
        if value is None:
            raise ValueError("object_name cannot be None")
        name = str(value).strip()
        if not name:
            raise ValueError("object_name cannot be empty")
        return name

    @field_validator("epoch", mode="before")
    @classmethod
    def validate_epoch(cls, value: Any) -> datetime:
        """Parse string or naive datetime into timezone-aware UTC datetime."""
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        elif isinstance(value, datetime):
            dt = value
        else:
            raise ValueError(f"Unsupported epoch format: {type(value)}")

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt

    @field_validator("retrieved_at", mode="before")
    @classmethod
    def validate_retrieved_at(cls, value: Any) -> datetime:
        """Ensure retrieved_at is timezone-aware UTC datetime."""
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        elif isinstance(value, datetime):
            dt = value
        else:
            raise ValueError(f"Unsupported retrieved_at format: {type(value)}")

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt

    @field_validator("mean_motion")
    @classmethod
    def validate_mean_motion(cls, value: float) -> float:
        """Mean motion must be strictly positive."""
        if value <= 0.0:
            raise ValueError(f"mean_motion must be strictly positive (> 0.0), got {value}")
        return float(value)

    @field_validator("eccentricity")
    @classmethod
    def validate_eccentricity(cls, value: float) -> float:
        """Eccentricity must be in range [0.0, 1.0) for closed bound orbits."""
        if value < 0.0 or value >= 1.0:
            raise ValueError(
                f"eccentricity must be in range [0.0, 1.0) for closed orbits, got {value}"
            )
        return float(value)

    @field_validator("inclination")
    @classmethod
    def validate_inclination(cls, value: float) -> float:
        """Inclination must be in range [0.0, 180.0] degrees."""
        if value < 0.0 or value > 180.0:
            raise ValueError(f"inclination must be between 0.0 and 180.0 degrees, got {value}")
        return float(value)

    @field_validator("ra_of_asc_node", "arg_of_pericenter", "mean_anomaly")
    @classmethod
    def validate_angles_360(cls, value: float) -> float:
        """Angular elements must be in range [0.0, 360.0] degrees."""
        if value < 0.0 or value > 360.0:
            raise ValueError(
                f"Angular orbital element must be in range [0.0, 360.0] degrees, got {value}"
            )
        return float(value)

    # Computed Astrodynamic Properties
    # Scientific Notice: These properties are mean two-body geometric estimates derived
    # directly from Keplerian mean motion (Brouwer / Kozai mean elements). They do NOT
    # represent instantaneous osculating orbital state vectors or calibrated radar tracking.
    # Instantaneous osculating altitude oscillates dynamically (e.g. +/- 10-20 km) due to J2.
    # Rounding to 3 decimal places (1 meter resolution) provides numerical consistency
    # and does not imply sub-kilometer observational accuracy (public TLE uncertainty
    # is typically ~0.5 to 2 km at epoch).
    @computed_field
    @property
    def semi_major_axis_km(self) -> float:
        """
        Estimated mean two-body semi-major axis in kilometers derived from mean motion:
        a = (mu / n^2)^(1/3).

        This is a mean orbital approximation, not an instantaneous osculating element.
        """
        n_rad_s = self.mean_motion * (2.0 * math.pi / SECONDS_PER_DAY)
        a = (EARTH_MU_KM3_S2 / (n_rad_s**2)) ** (1.0 / 3.0)
        return round(a, 3)

    @computed_field
    @property
    def period_minutes(self) -> float:
        """
        Estimated mean orbital period in minutes: T = 1440 / mean_motion.
        Derived from mean motion; does not reflect instantaneous nodal period.
        """
        return round(MINUTES_PER_DAY / self.mean_motion, 3)

    @computed_field
    @property
    def periapsis_altitude_km(self) -> float:
        """
        Estimated mean periapsis altitude in kilometers relative to WGS-84 equatorial radius:
        hp = a * (1 - e) - R_earth.

        Mean two-body geometric estimate; not an instantaneous osculating altitude.
        """
        return round(self.semi_major_axis_km * (1.0 - self.eccentricity) - EARTH_RADIUS_KM, 3)

    @computed_field
    @property
    def apoapsis_altitude_km(self) -> float:
        """
        Estimated mean apoapsis altitude in kilometers relative to WGS-84 equatorial radius:
        ha = a * (1 + e) - R_earth.

        Mean two-body geometric estimate; not an instantaneous osculating altitude.
        """
        return round(self.semi_major_axis_km * (1.0 + self.eccentricity) - EARTH_RADIUS_KM, 3)

    @classmethod
    def from_omm_dict(
        cls,
        data: dict[str, Any],
        data_source: DataSourceType = "LIVE",
        retrieved_at: datetime | None = None,
        is_synthetic: bool = False,
    ) -> "OrbitalObjectRecord":
        """
        Construct an OrbitalObjectRecord from raw CelesTrak OMM JSON dictionary.
        Preserves original raw data in `raw_omm`.
        """
        if not isinstance(data, dict):
            raise ValueError(f"Expected dict for OMM record, got {type(data)}")

        norad_id = data.get("NORAD_CAT_ID")
        if norad_id is None:
            raise ValueError("OMM data missing required 'NORAD_CAT_ID'")

        object_name = data.get("OBJECT_NAME")
        if not object_name:
            raise ValueError("OMM data missing required 'OBJECT_NAME'")

        epoch_str = data.get("EPOCH")
        if not epoch_str:
            raise ValueError("OMM data missing required 'EPOCH'")

        mean_motion = data.get("MEAN_MOTION")
        if mean_motion is None:
            raise ValueError("OMM data missing required 'MEAN_MOTION'")

        eccentricity = data.get("ECCENTRICITY")
        if eccentricity is None:
            raise ValueError("OMM data missing required 'ECCENTRICITY'")

        inclination = data.get("INCLINATION")
        if inclination is None:
            raise ValueError("OMM data missing required 'INCLINATION'")

        raan = data.get("RA_OF_ASC_NODE")
        if raan is None:
            raise ValueError("OMM data missing required 'RA_OF_ASC_NODE'")

        arg_p = data.get("ARG_OF_PERICENTER")
        if arg_p is None:
            raise ValueError("OMM data missing required 'ARG_OF_PERICENTER'")

        mean_m = data.get("MEAN_ANOMALY")
        if mean_m is None:
            raise ValueError("OMM data missing required 'MEAN_ANOMALY'")

        kwargs: dict[str, Any] = {
            "norad_cat_id": str(norad_id),
            "object_name": str(object_name).strip(),
            "object_id": str(data.get("OBJECT_ID", "UNKNOWN")).strip(),
            "classification_type": str(data.get("CLASSIFICATION_TYPE", "U")).strip(),
            "epoch": epoch_str,
            "mean_motion": float(mean_motion),
            "eccentricity": float(eccentricity),
            "inclination": float(inclination),
            "ra_of_asc_node": float(raan),
            "arg_of_pericenter": float(arg_p),
            "mean_anomaly": float(mean_m),
            "bstar": float(data.get("BSTAR", 0.0) or 0.0),
            "mean_motion_dot": float(data.get("MEAN_MOTION_DOT", 0.0) or 0.0),
            "mean_motion_ddot": float(data.get("MEAN_MOTION_DDOT", 0.0) or 0.0),
            "ephemeris_type": int(data.get("EPHEMERIS_TYPE", 0) or 0),
            "element_set_no": int(data.get("ELEMENT_SET_NO", 999) or 999),
            "rev_at_epoch": int(data.get("REV_AT_EPOCH", 0) or 0),
            "is_synthetic": is_synthetic,
            "data_source": data_source,
            "raw_omm": data,
        }

        if retrieved_at is not None:
            kwargs["retrieved_at"] = retrieved_at

        return cls(**kwargs)


class StateVectorRecord(BaseModel):
    """
    SGP4-propagated modelled analytical Cartesian state vector expressed in the TEME
    reference frame (or transformed coordinate frame).

    Reconstructs periodic perturbations within its analytical model; does not provide
    observational ground truth.

    Units: Position in kilometers (km), Velocity in kilometers per second (km/s).

    Supports both real catalog satellites (with norad_cat_id) and synthetic simulation
    objects (with generic object_id, leaving norad_cat_id as None).
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    norad_cat_id: str | None = Field(
        default=None,
        description=(
            "NORAD Catalog ID (string) if real catalog object; "
            "None for synthetic objects without NORAD IDs"
        ),
    )
    object_id: str = Field(
        default="UNKNOWN",
        description="Unique object identifier (NORAD ID, synthetic fragment ID, or COSPAR ID)",
    )
    object_name: str | None = Field(
        default=None,
        description="Human-readable object name (e.g. 'ISS (ZARYA)')",
    )
    epoch: datetime = Field(
        ...,
        description="Propagation timestamp in UTC",
    )
    frame: CoordinateFrame = Field(
        default="TEME",
        description=(
            "Reference coordinate frame ('TEME', 'GCRF', 'GCRS', 'ITRF', 'ITRS', 'RIC_LVLH'). "
            "SGP4 raw output is strictly 'TEME'."
        ),
    )
    position_km: tuple[float, float, float] = Field(
        ...,
        description="Cartesian position (X, Y, Z) in kilometers",
    )
    velocity_kms: tuple[float, float, float] = Field(
        ...,
        description="Cartesian velocity (VX, VY, VZ) in kilometers per second",
    )
    status: str = Field(
        default="OK",
        description="Propagation status ('OK', or specific SGP4 error description)",
    )
    sgp4_error_code: int = Field(
        default=0,
        description="SGP4 return error code (0 = success)",
    )

    @field_validator("epoch", mode="before")
    @classmethod
    def validate_epoch(cls, value: Any) -> datetime:
        """Parse string or datetime into timezone-aware UTC datetime."""
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        elif isinstance(value, datetime):
            dt = value
        else:
            raise ValueError(f"Unsupported epoch format: {type(value)}")

        if dt.tzinfo is None:
            raise ValueError("StateVectorRecord epoch must be timezone-aware (UTC).")
        return dt.astimezone(timezone.utc)

    @field_validator("norad_cat_id", mode="before")
    @classmethod
    def validate_norad_cat_id(cls, value: Any) -> str | None:
        if value is None:
            return None
        val_str = str(value).strip()
        return val_str if val_str else None

    @field_validator("object_id", mode="before")
    @classmethod
    def validate_object_id(cls, value: Any) -> str:
        if value is None:
            return "UNKNOWN"
        val_str = str(value).strip()
        return val_str if val_str else "UNKNOWN"

    @property
    def x(self) -> float:
        return self.position_km[0]

    @property
    def y(self) -> float:
        return self.position_km[1]

    @property
    def z(self) -> float:
        return self.position_km[2]

    @property
    def vx(self) -> float:
        return self.velocity_kms[0]

    @property
    def vy(self) -> float:
        return self.velocity_kms[1]

    @property
    def vz(self) -> float:
        return self.velocity_kms[2]

    @property
    def radius_km(self) -> float:
        return math.sqrt(sum(c**2 for c in self.position_km))

    @property
    def speed_kms(self) -> float:
        return math.sqrt(sum(c**2 for c in self.velocity_kms))


class HeuristicRiskScore(BaseModel):
    """
    Explainable heuristic risk scoring payload.
    Strictly marked with scientific disclaimer; never presented as formal Pc.
    """

    model_config = ConfigDict(validate_assignment=True)

    score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Normalized heuristic risk index [0.0 - 1.0]",
    )
    miss_distance_km: float = Field(
        ...,
        description="Estimated miss distance at Time of Closest Approach (km)",
    )
    relative_speed_kms: float = Field(
        ...,
        description="Relative velocity between objects at TCA (km/s)",
    )
    breakdown: dict[str, float] = Field(
        default_factory=dict,
        description="Explainable factor weights and penalties contributing to the score",
    )
    disclaimer: str = Field(
        default=HEURISTIC_RISK_DISCLAIMER,
        description="Non-negotiable scientific disclaimer string",
    )


class CatalogQueryResponse(BaseModel):
    """Container for API / client responses returning multiple orbital objects."""

    model_config = ConfigDict(validate_assignment=True)

    count: int
    data_source: DataSourceType
    retrieved_at: datetime
    objects: list[OrbitalObjectRecord]


class TrajectoryPoint(BaseModel):
    """
    Single discrete time step along an orbital trajectory.

    Units:
    - position_km: (X, Y, Z) in kilometers.
    - velocity_kms: (VX, VY, VZ) in kilometers per second.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    epoch: datetime = Field(
        ...,
        description="Timestamp of the orbital state in UTC",
    )
    position_km: tuple[float, float, float] = Field(
        ...,
        description="Cartesian position (X, Y, Z) in kilometers",
    )
    velocity_kms: tuple[float, float, float] = Field(
        ...,
        description="Cartesian velocity (VX, VY, VZ) in kilometers per second",
    )

    @field_validator("epoch", mode="before")
    @classmethod
    def validate_epoch(cls, value: Any) -> datetime:
        """Parse string or datetime into timezone-aware UTC datetime."""
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        elif isinstance(value, datetime):
            dt = value
        else:
            raise ValueError(f"Unsupported epoch format: {type(value)}")

        if dt.tzinfo is None:
            raise ValueError("TrajectoryPoint epoch must be timezone-aware (UTC).")
        return dt.astimezone(timezone.utc)

    @property
    def x(self) -> float:
        return self.position_km[0]

    @property
    def y(self) -> float:
        return self.position_km[1]

    @property
    def z(self) -> float:
        return self.position_km[2]

    @property
    def vx(self) -> float:
        return self.velocity_kms[0]

    @property
    def vy(self) -> float:
        return self.velocity_kms[1]

    @property
    def vz(self) -> float:
        return self.velocity_kms[2]

    @property
    def radius_km(self) -> float:
        return math.sqrt(sum(c**2 for c in self.position_km))

    @property
    def speed_kms(self) -> float:
        return math.sqrt(sum(c**2 for c in self.velocity_kms))


class SatelliteTrajectory(BaseModel):
    """
    Ephemeris trajectory of an orbital object over a time window in a single reference frame.

    All points strictly share the same reference frame and physical units.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    norad_cat_id: str | None = Field(
        default=None,
        description="NORAD Catalog ID (string) if real catalog object; None for synthetic objects",
    )
    object_id: str = Field(
        default="UNKNOWN",
        description="Unique object identifier (NORAD ID, synthetic fragment ID, or COSPAR ID)",
    )
    object_name: str | None = Field(
        default=None,
        description="Human-readable object name (e.g. 'ISS (ZARYA)')",
    )
    frame: CoordinateFrame = Field(
        default="TEME",
        description="Reference coordinate frame for all trajectory points",
    )
    position_unit: str = Field(
        default="km",
        description="Unit for Cartesian position (fixed at 'km')",
    )
    velocity_unit: str = Field(
        default="km/s",
        description="Unit for Cartesian velocity (fixed at 'km/s')",
    )
    points: list[TrajectoryPoint] = Field(
        default_factory=list,
        description="Chronologically ordered discrete trajectory points",
    )
    status: TrajectoryStatus = Field(
        default="SUCCESS",
        description=(
            "Trajectory status: 'SUCCESS' (all points), "
            "'PARTIAL' (partial points), 'FAILED' (no points)"
        ),
    )
    error_message: str | None = Field(
        default=None,
        description="Detailed failure description if status is not SUCCESS",
    )
    termination_reason: TrajectoryTerminationReason | None = Field(
        default=None,
        description=(
            "Reason for trajectory completion or termination "
            "(e.g. 'COMPLETED', 'ATMOSPHERIC_INTERFACE', 'NUMERICAL_FAILURE')"
        ),
    )
    mass_kg: float | None = Field(
        default=None,
        gt=0.0,
        description="Mass in kg for tracked synthetic fragments or catalog satellites if available",
    )
    is_synthetic: bool = Field(
        default=False,
        description=(
            "Strict synthetic provenance flag "
            "(True for synthetic fragments, False for real catalog objects)"
        ),
    )

    @property
    def point_count(self) -> int:
        return len(self.points)

    @property
    def is_empty(self) -> bool:
        return len(self.points) == 0

    @property
    def start_epoch(self) -> datetime | None:
        return self.points[0].epoch if self.points else None

    @property
    def end_epoch(self) -> datetime | None:
        return self.points[-1].epoch if self.points else None


class EarthOrientationQuality(BaseModel):
    """
    Quality and provenance metadata for Earth orientation parameters (IERS).

    Conveys whether Earth orientation parameters (UT1-UTC, polar motion) for
    inertial-to-terrestrial coordinate transformations rely on calibrated
    observations (Bulletin B or rapid Bulletin A), forward predictions within
    nominal horizons, unmaintained predictions, or uncalibrated boundary fallbacks.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    data_source: Literal[
        "DEFINITIVE",
        "RAPID",
        "PREDICTIVE_FRESH",
        "PREDICTIVE_STALE",
        "OUT_OF_RANGE",
        "HISTORICAL_FALLBACK",
        "UNAVAILABLE",
    ] = Field(..., description="Conservative data source tier of Earth orientation parameters.")

    is_degraded: bool = Field(
        ...,
        description="True if parameters rely on stale predictions (>30d) or boundary fallback.",
    )

    provenance_tier: Literal[
        "OBSERVED_EOP",
        "FORWARD_PREDICTION",
        "UNMAINTAINED_PREDICTION",
        "BOUNDARY_FALLBACK",
        "HISTORICAL_FALLBACK",
        "UNCALIBRATED_FALLBACK",
    ] = Field(..., description="Qualitative data provenance tier.")

    prediction_horizon_days: float | None = Field(
        default=None,
        description="Days elapsed between last definitive observation (MJD 61321.0) and requested epoch.",
    )

    table_publication_age_days: float | None = Field(
        default=None,
        description="Days elapsed between table publication and current date (None if unavailable in bundled table).",
    )

    local_cache_age_days: float | None = Field(
        default=None,
        description="Days elapsed since local cache file was refreshed (None if using bundled package table).",
    )

    ut1_status: int = Field(..., description="Raw Astropy status code for UT1-UTC.")
    pm_status: int = Field(..., description="Raw Astropy status code for polar motion.")

    earth_orientation_disclaimer: str = Field(
        ...,
        description="Scientific explanation of coordinate transformation assumptions.",
    )


class TrajectoryBatchResponse(BaseModel):
    """
    Container representing multi-satellite trajectory propagation results.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    count: int = Field(
        ...,
        description="Number of satellite trajectories in the batch",
    )
    successful_count: int = Field(
        ...,
        description=(
            "Number of satellites successfully propagated with all points (status='SUCCESS')"
        ),
    )
    failed_count: int = Field(
        default=0,
        description=(
            "Number of satellites that failed or yielded partial trajectories (status!='SUCCESS')"
        ),
    )
    target_frame: CoordinateFrame = Field(
        default="TEME",
        description="Reference coordinate frame common to all satellite trajectories in this batch",
    )
    start_time: datetime = Field(
        ...,
        description="Requested start time of the propagation window (UTC)",
    )
    end_time: datetime = Field(
        ...,
        description="Requested end time of the propagation window (UTC)",
    )
    step_seconds: float = Field(
        ...,
        description="Configured sampling interval in seconds",
    )
    generated_at: datetime = Field(
        ...,
        description="UTC timestamp when the batch propagation was computed",
    )
    trajectories: list[SatelliteTrajectory] = Field(
        default_factory=list,
        description="List of satellite trajectories",
    )
    earth_orientation: EarthOrientationQuality | None = Field(
        default=None,
        description="Quality and provenance metadata for Earth orientation parameters (IERS)",
    )


class ConjunctionEvent(BaseModel):
    """
    Representation of a single close-approach conjunction event between two orbital objects.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    event_id: str = Field(
        ...,
        description="Unique event identifier (e.g. 'CONJ-25544-48274-20261102T120530Z')",
    )
    object_1_id: str = Field(
        ...,
        description="Catalog or synthetic identifier for the primary object",
    )
    object_1_name: str | None = Field(
        default=None,
        description="Name of the primary object",
    )
    object_2_id: str = Field(
        ...,
        description="Catalog or synthetic identifier for the secondary object",
    )
    object_2_name: str | None = Field(
        default=None,
        description="Name of the secondary object",
    )
    tca: datetime = Field(
        ...,
        description="Refined Time of Closest Approach in UTC",
    )
    miss_distance_km: float = Field(
        ...,
        ge=0.0,
        description="Estimated miss distance at TCA in kilometers",
    )
    relative_position_km: tuple[float, float, float] = Field(
        ...,
        description="Relative position vector (r2 - r1) at TCA in kilometers",
    )
    relative_velocity_kms: tuple[float, float, float] = Field(
        ...,
        description="Relative velocity vector (v2 - v1) at TCA in kilometers per second",
    )
    relative_speed_kms: float = Field(
        ...,
        ge=0.0,
        description="Relative speed ||v2 - v1|| at TCA in kilometers per second",
    )
    category: ScreeningCategory = Field(
        ...,
        description="Screening classification category based on miss distance",
    )
    screening_threshold_km: float = Field(
        ...,
        gt=0.0,
        description="Screening distance threshold applied during screening (km)",
    )
    frame: CoordinateFrame = Field(
        default="GCRS",
        description="Coordinate reference frame of the relative states (e.g. 'GCRS')",
    )
    step_seconds: float = Field(
        ...,
        gt=0.0,
        description="Sampling interval in seconds used during initial coarse screening",
    )
    method: str = Field(
        default="NUMERICAL_OPTIMIZATION",
        description="Numerical method used for TCA refinement",
    )
    disclaimer: str = Field(
        default=CONJUNCTION_DISCLAIMER,
        description="Mandatory scientific disclaimer: preliminary screening, not formal Pc",
    )

    @field_validator("tca", mode="before")
    @classmethod
    def validate_tca(cls, value: Any) -> datetime:
        """Ensure TCA is a timezone-aware UTC datetime."""
        return normalize_datetime_utc(value, field_name="ConjunctionEvent TCA")

    @field_validator("miss_distance_km", "relative_speed_kms")
    @classmethod
    def validate_finite_kinematics(cls, v: float) -> float:
        """Ensure kinematic magnitudes are finite numbers."""
        if not math.isfinite(v):
            raise ValueError("Kinematic values must be finite numbers.")
        return v


class ConjunctionScreeningSummary(BaseModel):
    """
    Summary metrics of a conjunction screening execution.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    total_objects: int = Field(
        ...,
        ge=0,
        description="Total number of tracked objects submitted for screening",
    )
    total_pairs_considered: int = Field(
        ...,
        ge=0,
        description="Total unique object pairs evaluated",
    )
    total_events: int = Field(
        ...,
        ge=0,
        description="Total number of conjunction events identified below threshold",
    )
    critical_count: int = Field(
        default=0,
        ge=0,
        description="Number of conjunction events categorized as CRITICAL",
    )
    high_count: int = Field(
        default=0,
        ge=0,
        description="Number of conjunction events categorized as HIGH",
    )
    moderate_count: int = Field(
        default=0,
        ge=0,
        description="Number of conjunction events categorized as MODERATE",
    )
    low_count: int = Field(
        default=0,
        ge=0,
        description="Number of conjunction events categorized as LOW",
    )
    start_time: datetime = Field(
        ...,
        description="Start time of the screening window in UTC",
    )
    end_time: datetime = Field(
        ...,
        description="End time of the screening window in UTC",
    )
    step_seconds: float = Field(
        ...,
        gt=0.0,
        description="Configured sampling step size in seconds",
    )
    threshold_km: float = Field(
        ...,
        gt=0.0,
        description="Screening distance threshold applied in kilometers",
    )
    target_frame: CoordinateFrame = Field(
        default="GCRS",
        description="Coordinate reference frame used for screening",
    )
    processed_at: datetime = Field(
        ...,
        description="UTC timestamp when the screening was executed",
    )
    execution_time_seconds: float = Field(
        ...,
        ge=0.0,
        description="Total execution wall-clock time in seconds",
    )
    failed_objects_count: int = Field(
        default=0,
        ge=0,
        description="Number of submitted objects that failed propagation and were isolated",
    )
    resolved_objects_count: int = Field(
        default=0,
        ge=0,
        description="Number of objects successfully resolved and loaded into screening",
    )
    unresolved_norad_ids: list[int] = Field(
        default_factory=list,
        description="NORAD catalog IDs requested but failed to resolve from catalog",
    )
    earth_orientation: EarthOrientationQuality | None = Field(
        default=None,
        description="Quality and provenance metadata for Earth orientation parameters (IERS)",
    )


class ConjunctionScreeningResponse(BaseModel):
    """
    Complete response payload for conjunction screening.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    summary: ConjunctionScreeningSummary = Field(
        ...,
        description="Summary statistics of the screening run",
    )
    events: list[ConjunctionEvent] = Field(
        default_factory=list,
        description="Identified conjunction events ordered chronologically and by miss distance",
    )
    unresolved_norad_ids: list[int] = Field(
        default_factory=list,
        description="NORAD catalog IDs requested but failed to resolve from catalog",
    )
    earth_orientation: EarthOrientationQuality | None = Field(
        default=None,
        description="Quality and provenance metadata for Earth orientation parameters (IERS)",
    )
    disclaimer: str = Field(
        default=CONJUNCTION_DISCLAIMER,
        description="Mandatory scientific disclaimer string",
    )


class ConjunctionScreeningRequest(BaseModel):
    """
    Request payload for conjunction screening API endpoint.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        extra="ignore",
    )

    objects: list[OrbitalObjectRecord | dict[str, Any]] = Field(
        default_factory=list,
        description="List of orbital objects or raw OMM dictionaries to screen",
    )
    norad_ids: list[str | int] | None = Field(
        default=None,
        description="Optional list of NORAD IDs to resolve against catalog / fixture cache",
    )
    start_time: datetime = Field(
        ...,
        description="Start of screening window in UTC",
    )
    end_time: datetime = Field(
        ...,
        description="End of screening window in UTC",
    )
    step_seconds: float = Field(
        default=60.0,
        description="Sampling interval in seconds (> 0.0)",
    )
    threshold_km: float = Field(
        default=10.0,
        description="Distance screening threshold in kilometers (> 0.0)",
    )
    target_frame: CoordinateFrame = Field(
        default="GCRS",
        description="Coordinate reference frame for screening (default 'GCRS')",
    )
    threshold_critical_km: float = Field(
        default=1.0,
        description="Threshold below which conjunction is categorized as CRITICAL (km)",
    )
    threshold_high_km: float = Field(
        default=5.0,
        description="Threshold below which conjunction is categorized as HIGH (km)",
    )
    threshold_moderate_km: float = Field(
        default=10.0,
        description="Threshold below which conjunction is categorized as MODERATE (km)",
    )

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def validate_utc(cls, value: Any) -> datetime:
        """Ensure datetime fields are timezone-aware UTC."""
        return normalize_datetime_utc(value, field_name="Screening datetime")

    @model_validator(mode="after")
    def validate_screening_parameters(self) -> ConjunctionScreeningRequest:
        """Validate parameter ranges and relationships."""
        if self.end_time < self.start_time:
            raise ValueError(
                f"end_time ({self.end_time.isoformat()}) must be >= "
                f"start_time ({self.start_time.isoformat()})"
            )
        if not math.isfinite(self.step_seconds) or self.step_seconds <= 0.0:
            raise ValueError(f"step_seconds must be finite and > 0.0, got {self.step_seconds}")
        if not math.isfinite(self.threshold_km) or self.threshold_km <= 0.0:
            raise ValueError(f"threshold_km must be finite and > 0.0, got {self.threshold_km}")
        for name, val in [
            ("threshold_critical_km", self.threshold_critical_km),
            ("threshold_high_km", self.threshold_high_km),
            ("threshold_moderate_km", self.threshold_moderate_km),
        ]:
            if not math.isfinite(val) or val <= 0.0:
                raise ValueError(f"{name} must be finite and > 0.0, got {val}")

        if not (self.threshold_critical_km < self.threshold_high_km <= self.threshold_moderate_km):
            raise ValueError(
                "Classification thresholds must satisfy: "
                "0 < threshold_critical_km < threshold_high_km <= threshold_moderate_km"
            )
        return self


# ============================================================================
# Day 7 Risk Engine Domain Schemas (Explainable Heuristic Prioritization)
# ============================================================================


class RiskCategory(str, Enum):
    """
    Operational qualitative risk triage tiers.

    - CRITICAL: 75.0 <= score <= 100.0
    - HIGH: 50.0 <= score < 75.0
    - MODERATE: 25.0 <= score < 50.0
    - LOW: 10.0 <= score < 25.0
    - NEGLIGIBLE: 0.0 <= score < 10.0
    """

    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LOW = "LOW"
    NEGLIGIBLE = "NEGLIGIBLE"


class DataQualityLevel(str, Enum):
    """Kinematic data quality assessment level."""

    COMPLETE = "COMPLETE"
    INCOMPLETE = "INCOMPLETE"


class RiskWeights(BaseModel):
    """
    Configurable dimensional weights for heuristic risk scoring.
    All weights must be non-negative, finite numbers and sum to 1.0 (+/- 1e-6).
    """

    model_config = ConfigDict(extra="forbid")

    weight_distance: float = Field(
        default=0.50,
        ge=0.0,
        description="Weight assigned to miss distance factor (default 0.50)",
    )
    weight_speed: float = Field(
        default=0.25,
        ge=0.0,
        description="Weight assigned to encounter relative speed factor (default 0.25)",
    )
    weight_time: float = Field(
        default=0.25,
        ge=0.0,
        description="Weight assigned to time-to-TCA factor (default 0.25)",
    )

    @model_validator(mode="after")
    def validate_weights(self) -> RiskWeights:
        for name, val in [
            ("weight_distance", self.weight_distance),
            ("weight_speed", self.weight_speed),
            ("weight_time", self.weight_time),
        ]:
            if not isinstance(val, (int, float)) or not math.isfinite(val) or val < 0.0:
                raise ValueError(f"{name} must be a non-negative finite number.")
        total = self.weight_distance + self.weight_speed + self.weight_time
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"Risk weights must sum to 1.0 (got {total:.6f}).")
        return self


class RiskFactor(BaseModel):
    """Individual dimensional component of the heuristic risk score."""

    model_config = ConfigDict(extra="ignore")

    factor_name: str = Field(..., description="Name of scoring dimension")
    raw_value: float = Field(..., description="Raw physical kinematic value")
    raw_units: str = Field(..., description="Measurement units of raw value")
    normalized_value: float = Field(..., ge=0.0, le=1.0, description="Normalized score [0.0 - 1.0]")
    weight: float = Field(..., ge=0.0, le=1.0, description="Applied linear weight")
    contribution: float = Field(
        ..., ge=0.0, le=100.0, description="Weighted point contribution to total score"
    )
    description: str = Field(..., description="Human-readable explanation of factor calculation")


class RiskAssessment(BaseModel):
    """Complete heuristic risk assessment for a single conjunction event."""

    model_config = ConfigDict(extra="ignore")

    event_id: str = Field(..., description="Identifier of the assessed conjunction event")
    primary_object_id: str = Field(..., description="Identifier of the primary object")
    primary_object_name: str | None = Field(default=None, description="Name of the primary object")
    secondary_object_id: str = Field(..., description="Identifier of the secondary object")
    secondary_object_name: str | None = Field(
        default=None, description="Name of the secondary object"
    )
    tca: datetime = Field(..., description="Time of Closest Approach in UTC")
    miss_distance_km: float = Field(..., ge=0.0, description="Miss distance at TCA in km")
    relative_speed_kms: float = Field(..., ge=0.0, description="Encounter relative speed in km/s")
    risk_score: float = Field(
        ..., ge=0.0, le=100.0, description="Heuristic Risk Score [0.0 - 100.0]"
    )
    risk_category: RiskCategory = Field(..., description="Five-tier qualitative risk tier")
    evaluation_time: datetime = Field(..., description="Authoritative evaluation epoch in UTC")
    factors: list[RiskFactor] = Field(..., description="Component breakdown of scoring dimensions")
    data_quality: DataQualityLevel = Field(
        ..., description="Quality assessment of input kinematics"
    )
    warnings: list[str] = Field(
        default_factory=list, description="Non-fatal warnings or physical notices"
    )
    scientific_disclaimer: str = Field(..., description="Mandatory scientific disclaimer")

    @field_validator("tca", "evaluation_time", mode="before")
    @classmethod
    def validate_assessment_datetimes(cls, v: Any) -> datetime:
        return normalize_datetime_utc(v, field_name="RiskAssessment datetime")


class RiskAssessmentRequest(BaseModel):
    """Request payload for assessing a single conjunction event."""

    model_config = ConfigDict(extra="ignore")

    event: ConjunctionEvent = Field(..., description="Conjunction event to assess")
    evaluation_time: datetime | None = Field(
        default=None,
        description="Evaluation reference epoch. Defaults to current UTC.",
    )
    custom_weights: RiskWeights | None = Field(
        default=None,
        description="Optional custom factor weights summing to 1.0",
    )

    @field_validator("evaluation_time", mode="before")
    @classmethod
    def validate_eval_time(cls, v: Any) -> datetime | None:
        return normalize_datetime_utc(v, field_name="evaluation_time") if v is not None else None


class RiskAssessmentBatchRequest(BaseModel):
    """Request payload for batch assessing multiple conjunction events."""

    model_config = ConfigDict(extra="ignore")

    events: list[ConjunctionEvent] = Field(
        default_factory=list,
        description="List of screened conjunction events",
    )
    evaluation_time: datetime | None = Field(
        default=None,
        description="Authoritative evaluation epoch for all events in batch",
    )
    custom_weights: RiskWeights | None = Field(
        default=None,
        description="Common custom weights for all events in batch",
    )

    @field_validator("events")
    @classmethod
    def validate_unique_event_ids(cls, events: list[ConjunctionEvent]) -> list[ConjunctionEvent]:
        seen: set[str] = set()
        for ev in events:
            if ev.event_id in seen:
                raise ValueError(f"Duplicate event_id '{ev.event_id}' detected in batch request.")
            seen.add(ev.event_id)
        return events

    @field_validator("evaluation_time", mode="before")
    @classmethod
    def validate_eval_time(cls, v: Any) -> datetime | None:
        return normalize_datetime_utc(v, field_name="evaluation_time") if v is not None else None


class RiskAssessmentBatchResponse(BaseModel):
    """Batch assessment response container."""

    model_config = ConfigDict(extra="ignore")

    total_assessed: int = Field(..., ge=0, description="Total number of conjunction events scored")
    critical_count: int = Field(..., ge=0, description="Count of events in CRITICAL tier")
    high_count: int = Field(..., ge=0, description="Count of events in HIGH tier")
    moderate_count: int = Field(..., ge=0, description="Count of events in MODERATE tier")
    low_count: int = Field(..., ge=0, description="Count of events in LOW tier")
    negligible_count: int = Field(..., ge=0, description="Count of events in NEGLIGIBLE tier")
    evaluation_time: datetime = Field(
        ..., description="Authoritative evaluation epoch used for batch (UTC)"
    )
    assessments: list[RiskAssessment] = Field(
        default_factory=list,
        description="Deterministic sorted list of assessments",
    )

    @field_validator("evaluation_time", mode="before")
    @classmethod
    def validate_batch_response_eval_time(cls, v: Any) -> datetime:
        return normalize_datetime_utc(v, field_name="evaluation_time")
