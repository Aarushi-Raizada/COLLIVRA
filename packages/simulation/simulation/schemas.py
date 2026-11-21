"""
Pydantic schemas for synthetic collision fragmentation and numerical propagation in GCRS.
"""

import math
from datetime import datetime, timedelta, timezone
from enum import Enum
from math import sqrt
from typing import Any, Literal, Optional

import numpy as np
from orbital_core.schemas import (
    TrajectoryPoint,
    TrajectoryStatus,
    TrajectoryTerminationReason,
    normalize_datetime_utc,
)
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .constants import (
    DEFAULT_ATOL_POSITION_KM,
    DEFAULT_ATOL_VELOCITY_KMS,
    DEFAULT_COLLISION_TOLERANCE_KM,
    DEFAULT_FRAGMENT_COUNT,
    DEFAULT_IDENTIFIER_PREFIX,
    DEFAULT_INTEGRATOR_METHOD,
    DEFAULT_MAX_BATCH_POINTS,
    DEFAULT_MAX_DELTA_V_KMS,
    DEFAULT_MAX_FRAGMENT_MASS_KG,
    DEFAULT_MAX_POINTS_PER_TRAJECTORY,
    DEFAULT_MAX_STEP_SECONDS,
    DEFAULT_MIN_FRAGMENT_MASS_KG,
    DEFAULT_POWER_LAW_EXPONENT,
    DEFAULT_PROPAGATION_DURATION_SECONDS,
    DEFAULT_RTOL,
    DEFAULT_SAMPLING_STEP_SECONDS,
    DEFAULT_SEED,
    DEFAULT_V_MEDIAN_KMS,
    DEFAULT_V_SIGMA,
    MAX_TARGETING_KNOT_STEP_SECONDS,
    MODEL_NAME,
    MU_EARTH_KM3_S2,
    PROPAGATION_DISCLAIMER,
    SIMULATION_DISCLAIMER,
)

TerminationReason = TrajectoryTerminationReason


class FragmentationConfig(BaseModel):
    """Configuration governing the simplified synthetic fragmentation model."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    fragment_count: int = Field(
        default=DEFAULT_FRAGMENT_COUNT,
        ge=1,
        le=5000,
        description="Target number of tracked fragments",
    )
    min_fragment_mass_kg: float = Field(
        default=DEFAULT_MIN_FRAGMENT_MASS_KG,
        gt=0.0,
        description="Minimum fragment mass in kg",
    )
    max_fragment_mass_kg: float = Field(
        default=DEFAULT_MAX_FRAGMENT_MASS_KG,
        gt=0.0,
        description="Maximum fragment mass in kg",
    )
    v_median_kms: float = Field(
        default=DEFAULT_V_MEDIAN_KMS,
        gt=0.0,
        description="Median ejection speed in km/s (Log-Normal distribution)",
    )
    v_sigma: float = Field(
        default=DEFAULT_V_SIGMA,
        gt=0.0,
        description="Log-dispersion parameter for Log-Normal speed distribution",
    )
    max_delta_v_kms: float = Field(
        default=DEFAULT_MAX_DELTA_V_KMS,
        gt=0.0,
        description="Maximum ejection delta-V ceiling in km/s",
    )
    power_law_exponent: float = Field(
        default=DEFAULT_POWER_LAW_EXPONENT,
        gt=0.0,
        description="Power law exponent for differential mass PDF (alpha)",
    )
    seed: int | None = Field(
        default=DEFAULT_SEED,
        description="Random seed for deterministic simulation (None for unseeded)",
    )
    identifier_prefix: str = Field(
        default=DEFAULT_IDENTIFIER_PREFIX,
        description="Prefix for fragment identifiers (e.g. 'SYNTH-FRAG')",
    )

    @field_validator("max_fragment_mass_kg")
    @classmethod
    def validate_mass_bounds(cls, v: float, info: Any) -> float:
        min_m = info.data.get("min_fragment_mass_kg", DEFAULT_MIN_FRAGMENT_MASS_KG)
        if v < min_m:
            raise ValueError(
                f"max_fragment_mass_kg ({v}) cannot be less than min_fragment_mass_kg ({min_m})"
            )
        return float(v)


class ParentBodyState(BaseModel):
    """Kinematic and physical state of a colliding parent body."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    object_id: str = Field(..., description="Unique parent identifier (NORAD ID or string)")
    object_name: str | None = Field(default=None, description="Human-readable object name")
    mass_kg: float = Field(..., gt=0.0, description="Parent body mass in kilograms (> 0.0)")
    position_km: tuple[float, float, float] = Field(
        ..., description="Cartesian position (X, Y, Z) in km"
    )
    velocity_kms: tuple[float, float, float] = Field(
        ..., description="Cartesian velocity (VX, VY, VZ) in km/s"
    )


class CollisionScenario(BaseModel):
    """Authoritative collision scenario datum and colliding bodies in GCRS."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    collision_epoch: datetime = Field(..., description="Collision timestamp in UTC")
    frame: Literal["GCRS"] = Field(
        default="GCRS",
        description="Authoritative frame (strictly GCRS in Day 8 v1)",
    )
    collision_tolerance_km: float = Field(
        default=DEFAULT_COLLISION_TOLERANCE_KM,
        gt=0.0,
        description="Maximum separation between parent positions at collision epoch in km",
    )
    parent_a: ParentBodyState = Field(..., description="First colliding body")
    parent_b: ParentBodyState = Field(..., description="Second colliding body")
    config: FragmentationConfig = Field(
        default_factory=FragmentationConfig, description="Breakup parameters"
    )

    @field_validator("collision_epoch", mode="before")
    @classmethod
    def validate_utc_epoch(cls, value: Any) -> datetime:
        return normalize_datetime_utc(value)

    @field_validator("frame", mode="before")
    @classmethod
    def validate_gcrs_frame(cls, value: str) -> Literal["GCRS"]:
        if value != "GCRS":
            raise ValueError(
                f"Collision scenario frame '{value}' is rejected in Day 8 v1. "
                "Collision fragmentation kinematics require an inertial frame and are strictly "
                "restricted to 'GCRS'. TEME, ITRS, ITRF, and relative frames are not permitted "
                "without explicit validated coordinate transformations."
            )
        return "GCRS"

    @model_validator(mode="after")
    def validate_parent_proximity(self) -> "CollisionScenario":
        """Ensure parent bodies are within physical proximity tolerance at collision epoch."""
        xa, ya, za = self.parent_a.position_km
        xb, yb, zb = self.parent_b.position_km
        sep = sqrt((xa - xb) ** 2 + (ya - yb) ** 2 + (za - zb) ** 2)
        if sep > self.collision_tolerance_km:
            raise ValueError(
                f"Parent bodies '{self.parent_a.object_id}' and '{self.parent_b.object_id}' "
                f"are separated by {sep:.4f} km at collision_epoch, exceeding "
                f"collision_tolerance_km ({self.collision_tolerance_km} km). "
                "Colliding parents must be in physical proximity at the authoritative epoch."
            )
        return self


class SyntheticFragmentRecord(BaseModel):
    """Domain record representing an individual synthetic fragment."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    fragment_id: str = Field(..., description="Unique fragment ID (e.g. 'SYNTH-FRAG-0001')")
    source_parent_id: Literal["COMBINED"] = Field(
        default="COMBINED",
        description="Source attribution; 'COMBINED' for macroscopic collision breakup",
    )
    epoch: datetime = Field(..., description="Epoch of breakup in UTC")
    frame: Literal["GCRS"] = Field(
        default="GCRS", description="Reference frame (strictly GCRS in Day 8 v1)"
    )
    position_km: tuple[float, float, float] = Field(
        ..., description="Cartesian position (X, Y, Z) in km"
    )
    velocity_kms: tuple[float, float, float] = Field(
        ..., description="Cartesian velocity (VX, VY, VZ) in km/s"
    )
    mass_kg: float = Field(..., gt=0.0, description="Fragment mass in kg")
    delta_v_kms: float = Field(..., ge=0.0, description="Ejection delta-v magnitude in km/s")
    ejection_vector_kms: tuple[float, float, float] = Field(
        ..., description="Ejection delta-v vector (DVx, DVy, DVz) in km/s"
    )
    is_synthetic: Literal[True] = Field(
        default=True, description="Strict synthetic provenance flag"
    )

    @field_validator("epoch", mode="before")
    @classmethod
    def validate_utc_fragment_epoch(cls, value: Any) -> datetime:
        return normalize_datetime_utc(value)


class FragmentationMetadata(BaseModel):
    """Physical accounting, momentum conservation metrics, and model disclaimers."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    model_name: str = Field(
        default=MODEL_NAME,
        description="Explicit model identification",
    )
    fidelity_disclaimer: str = Field(
        default=SIMULATION_DISCLAIMER,
        description="Scientific fidelity disclaimer",
    )
    seed_used: int | None = Field(..., description="Seed used for random number generation")
    parent_a_id: str = Field(..., description="First parent ID")
    parent_b_id: str = Field(..., description="Second parent ID")
    total_parent_mass_kg: float = Field(
        ..., description="Total combined parent mass (m_A + m_B) in kg"
    )
    tracked_fragment_mass_kg: float = Field(..., description="Sum of tracked fragment masses in kg")
    residual_mass_kg: float = Field(..., description="Unmodeled residual debris mass in kg")
    tracked_fragment_count: int = Field(..., description="Number of tracked fragments generated")
    center_of_mass_velocity_kms: tuple[float, float, float] = Field(
        ..., description="System center-of-mass velocity in km/s"
    )
    center_of_mass_position_km: tuple[float, float, float] = Field(
        ..., description="System center-of-mass position in km"
    )
    drift_velocity_removed_ms: float = Field(
        ..., description="Tracked ensemble center-of-mass drift removed in m/s"
    )
    momentum_residual_kg_kms: float = Field(
        ..., description="Total system linear momentum residual in kg*km/s"
    )


class FragmentationResult(BaseModel):
    """Complete output of a collision fragmentation simulation."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    scenario: CollisionScenario = Field(..., description="Input scenario")
    fragments: list[SyntheticFragmentRecord] = Field(
        ..., description="Generated synthetic fragments"
    )
    metadata: FragmentationMetadata = Field(..., description="Conservation metrics and disclaimers")


# ============================================================================
# Day 9: Numerical Propagation Schemas
# ============================================================================


class NumericalPropagationConfig(BaseModel):
    """Configuration governing numerical orbital propagation of synthetic fragments in GCRS."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    duration_seconds: float = Field(
        default=DEFAULT_PROPAGATION_DURATION_SECONDS,
        gt=0.0,
        description="Propagation duration in seconds (> 0)",
    )
    step_seconds: float = Field(
        default=DEFAULT_SAMPLING_STEP_SECONDS,
        gt=0.0,
        description="Output trajectory sampling interval in seconds (> 0)",
    )
    integrator: Literal["DOP853"] = Field(
        default=DEFAULT_INTEGRATOR_METHOD,
        description="ODE integrator method (explicit 8(5,3) Dormand-Prince)",
    )
    rtol: float = Field(
        default=DEFAULT_RTOL,
        gt=0.0,
        description="Relative integration tolerance",
    )
    atol_position_km: float = Field(
        default=DEFAULT_ATOL_POSITION_KM,
        gt=0.0,
        description="Absolute position tolerance in km (1 mm = 1e-9 km)",
    )
    atol_velocity_kms: float = Field(
        default=DEFAULT_ATOL_VELOCITY_KMS,
        gt=0.0,
        description="Absolute velocity tolerance in km/s (0.1 um/s = 1e-10 km/s)",
    )
    max_step_seconds: float = Field(
        default=DEFAULT_MAX_STEP_SECONDS,
        gt=0.0,
        description="Maximum internal step size for ODE solver in seconds",
    )
    max_points_per_trajectory: int = Field(
        default=DEFAULT_MAX_POINTS_PER_TRAJECTORY,
        ge=2,
        description="Maximum allowed points for a single trajectory",
    )
    max_batch_points: int = Field(
        default=DEFAULT_MAX_BATCH_POINTS,
        ge=2,
        description="Maximum allowed points across all trajectories in a batch",
    )

    @model_validator(mode="after")
    def validate_step_and_duration(self) -> "NumericalPropagationConfig":
        if self.step_seconds > self.duration_seconds:
            raise ValueError(
                f"step_seconds ({self.step_seconds}s) cannot be greater than "
                f"duration_seconds ({self.duration_seconds}s)."
            )
        return self


class FragmentTrajectory(BaseModel):
    """
    Ephemeris trajectory of a single synthetic fragment propagated numerically in GCRS.
    """

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    fragment_id: str = Field(..., description="Unique fragment identifier")
    frame: Literal["GCRS"] = Field(
        default="GCRS",
        description="Reference coordinate frame (strictly GCRS)",
    )
    position_unit: str = Field(
        default="km",
        description="Cartesian position unit (fixed at 'km')",
    )
    velocity_unit: str = Field(
        default="km/s",
        description="Cartesian velocity unit (fixed at 'km/s')",
    )
    points: list[TrajectoryPoint] = Field(
        default_factory=list,
        description="Chronologically ordered discrete trajectory points",
    )
    status: TrajectoryStatus = Field(
        default="SUCCESS",
        description=(
            "Trajectory status: 'SUCCESS' (all points), 'PARTIAL' (truncated), 'FAILED' (no points)"
        ),
    )
    termination_reason: TerminationReason = Field(
        default="COMPLETED",
        description="Reason for trajectory termination",
    )
    mass_kg: float | None = Field(
        default=None,
        gt=0.0,
        description="Fragment mass in kg if tracked",
    )
    error_message: str | None = Field(
        default=None,
        description="Detailed failure description if status is not SUCCESS",
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

    @property
    def reentry_epoch(self) -> datetime | None:
        if self.termination_reason == "ATMOSPHERIC_INTERFACE" and self.points:
            return self.points[-1].epoch
        return None

    def to_satellite_trajectory(self) -> Any:
        """Convert to orbital_core standard SatelliteTrajectory."""
        from orbital_core.schemas import SatelliteTrajectory

        return SatelliteTrajectory(
            norad_cat_id=None,
            object_id=self.fragment_id,
            object_name=f"SYNTH-FRAG {self.fragment_id}",
            frame="GCRS",
            position_unit=self.position_unit,
            velocity_unit=self.velocity_unit,
            points=self.points,
            status=self.status,
            error_message=self.error_message,
            termination_reason=self.termination_reason,
            mass_kg=self.mass_kg,
            is_synthetic=True,
        )


class FragmentPropagationSummary(BaseModel):
    """Scientific summary and metrics for a batch numerical propagation."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    total_fragments: int = Field(..., ge=0, description="Total fragments in batch")
    completed_count: int = Field(..., ge=0, description="Fragments completing full duration")
    reentered_count: int = Field(
        ..., ge=0, description="Fragments terminating at 100 km atmospheric interface"
    )
    numerical_failure_count: int = Field(
        ..., ge=0, description="Fragments encountering solver failures"
    )
    invalid_state_count: int = Field(..., ge=0, description="Fragments with invalid initial states")
    duration_seconds: float = Field(..., gt=0.0, description="Requested duration in seconds")
    step_seconds: float = Field(..., gt=0.0, description="Requested sampling step in seconds")
    execution_wall_time_seconds: float = Field(
        ..., ge=0.0, description="Computation wall-clock time in seconds"
    )
    model_name: str = Field(default=MODEL_NAME, description="Model identifier")
    fidelity_disclaimer: str = Field(
        default=PROPAGATION_DISCLAIMER, description="Scientific fidelity disclaimer"
    )


class FragmentTrajectoryBatch(BaseModel):
    """
    Container representing batch numerical propagation results for synthetic fragments.
    """

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    scenario_epoch: datetime = Field(..., description="Common scenario start epoch in UTC")
    frame: Literal["GCRS"] = Field(
        default="GCRS",
        description="Reference coordinate frame (strictly GCRS)",
    )
    count: int = Field(..., ge=0, description="Total number of fragment trajectories in batch")
    successful_count: int = Field(
        ..., ge=0, description="Number of trajectories with status='SUCCESS'"
    )
    failed_count: int = Field(
        ..., ge=0, description="Number of trajectories with status!='SUCCESS' (PARTIAL or FAILED)"
    )
    summary: FragmentPropagationSummary = Field(
        ..., description="Batch summary and performance metrics"
    )
    trajectories: list[FragmentTrajectory] = Field(
        default_factory=list, description="Propagated fragment trajectories"
    )

    @field_validator("scenario_epoch", mode="before")
    @classmethod
    def validate_utc_scenario_epoch(cls, value: Any) -> datetime:
        return normalize_datetime_utc(value)

    def to_trajectory_batch_response(self) -> Any:
        """Convert to orbital_core standard TrajectoryBatchResponse."""
        from datetime import timedelta

        from orbital_core.schemas import TrajectoryBatchResponse

        end_time = self.scenario_epoch + timedelta(seconds=self.summary.duration_seconds)
        return TrajectoryBatchResponse(
            count=self.count,
            successful_count=self.successful_count,
            failed_count=self.failed_count,
            target_frame="GCRS",
            start_time=self.scenario_epoch,
            end_time=end_time,
            step_seconds=self.summary.step_seconds,
            generated_at=datetime.now(timezone.utc),
            trajectories=[t.to_satellite_trajectory() for t in self.trajectories],
        )


# ============================================================================
# Day 10: Clohessy-Wiltshire Relative Motion & Rendezvous Schemas
# ============================================================================


class TargetingMode(str, Enum):
    """Targeting mode for Clohessy-Wiltshire rendezvous planning."""

    STANDOFF_HOLD = "STANDOFF_HOLD"
    CONTACT_INTERCEPT = "CONTACT_INTERCEPT"


class RendezvousConfig(BaseModel):
    """Configuration parameters for two-impulse Clohessy-Wiltshire rendezvous planning.

    Scientific Note:
        STANDOFF_HOLD specifies a nonzero nominal standoff target geometry. It does NOT
        certify operational flight safety or guarantee collision freedom under full
        nonlinear, perturbed astrodynamics.
    """

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    targeting_mode: TargetingMode = Field(
        default=TargetingMode.STANDOFF_HOLD,
        description=(
            "Targeting objective: STANDOFF_HOLD (nominal standoff target) or "
            "CONTACT_INTERCEPT (direct intercept)."
        ),
    )
    standoff_distance_m: float = Field(
        default=100.0,
        description="Nominal along-track (V-bar) standoff distance in meters. Default 100 m.",
    )
    delta_v_budget_max_ms: float = Field(
        default=100.0,
        gt=0.0,
        description="Maximum permissible total Delta-V budget in m/s. Default 100 m/s.",
    )
    transfer_time_s: float = Field(
        default=3600.0,
        gt=0.0,
        description="Transfer time duration in seconds. Default 3600 s (1 hour).",
    )
    epoch_tolerance_s: float = Field(
        default=10.0,
        ge=0.0,
        description="Maximum permissible epoch discrepancy between target and chaser in seconds.",
    )
    max_condition_number: float = Field(
        default=1e7,
        gt=1.0,
        description="Maximum allowable L2 condition number for Phi_rv matrix inversion.",
    )
    target_cross_check_position_tol_km: float = Field(
        default=1e-3,
        gt=0.0,
        description=(
            "Position consistency tolerance between contract target state and "
            "trajectory (km). Default 1.0 m."
        ),
    )
    target_cross_check_velocity_tol_kms: float = Field(
        default=1e-4,
        gt=0.0,
        description=(
            "Velocity consistency tolerance between contract target state and "
            "trajectory (km/s). Default 0.1 m/s."
        ),
    )

    @field_validator("standoff_distance_m")
    @classmethod
    def validate_standoff_distance(cls, v: float, info: Any) -> float:
        if not math.isfinite(v):
            raise ValueError("standoff_distance_m must be finite.")
        if v < 0.0:
            raise ValueError(f"standoff_distance_m must be non-negative (got {v} m).")
        mode = info.data.get("targeting_mode", TargetingMode.STANDOFF_HOLD)
        if mode == TargetingMode.STANDOFF_HOLD and v < 10.0:
            raise ValueError(
                f"STANDOFF_HOLD requires standoff_distance_m >= 10.0 m (got {v} m). "
                "Use CONTACT_INTERCEPT for close proximity or intercept targeting."
            )
        if mode == TargetingMode.CONTACT_INTERCEPT and v > 1e-3:
            raise ValueError(
                f"CONTACT_INTERCEPT requires 0.0 <= standoff_distance_m <= 1e-3 m (got {v} m)."
            )
        return float(v)


class RendezvousContract(BaseModel):
    """Input contract specifying chief, target, and chaser initial states in GCRS."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    target_id: str = Field(
        ..., min_length=1, description="Catalog ID or synthetic fragment ID of target."
    )
    chaser_id: str = Field(..., min_length=1, description="Identifier of chaser spacecraft.")
    target_is_synthetic: bool = Field(
        default=False, description="True if target is a synthetic fragment."
    )

    target_epoch_utc: datetime = Field(
        ..., description="Measurement epoch of target state (normalized to UTC)."
    )
    chaser_epoch_utc: datetime = Field(
        ..., description="Measurement epoch of chaser state (normalized to UTC)."
    )

    target_gcrs_position_km: list[float] = Field(..., min_length=3, max_length=3)
    target_gcrs_velocity_kms: list[float] = Field(..., min_length=3, max_length=3)
    chaser_gcrs_position_km: list[float] = Field(..., min_length=3, max_length=3)
    chaser_gcrs_velocity_kms: list[float] = Field(..., min_length=3, max_length=3)

    @field_validator("target_epoch_utc", "chaser_epoch_utc", mode="before")
    @classmethod
    def validate_and_normalize_utc(cls, value: Any) -> datetime:
        return normalize_datetime_utc(value)

    @field_validator(
        "target_gcrs_position_km",
        "target_gcrs_velocity_kms",
        "chaser_gcrs_position_km",
        "chaser_gcrs_velocity_kms",
        mode="before",
    )
    @classmethod
    def validate_finite_coords(cls, v: Any, info: Any) -> list[float]:
        field_name = info.field_name if hasattr(info, "field_name") else "coordinate"
        if isinstance(v, (str, bytes)):
            raise ValueError(f"{field_name} cannot be a string or bytes.")
        if not isinstance(v, (list, tuple, np.ndarray)):
            raise ValueError(
                f"{field_name} must be a sequence of 3 floats, got {type(v).__name__}."
            )
        if isinstance(v, np.ndarray):
            if v.ndim != 1:
                raise ValueError(
                    f"{field_name} must be a 1D sequence of length 3, got shape {v.shape}."
                )
            if np.iscomplexobj(v):
                raise ValueError(f"{field_name} cannot contain complex numbers.")
            if v.dtype.kind not in ("i", "u", "f"):
                raise ValueError(f"{field_name} must contain real numeric values.")
        if len(v) != 3:
            raise ValueError(f"{field_name} must have exactly 3 components, got {len(v)}.")

        validated: list[float] = []
        for idx, elem in enumerate(v):
            if isinstance(elem, (bool, np.bool_)):
                raise ValueError(f"{field_name}[{idx}] cannot be a boolean.")
            if isinstance(elem, (str, bytes)):
                raise ValueError(f"{field_name}[{idx}] cannot be a string or bytes.")
            if isinstance(elem, (complex, np.complexfloating)):
                raise ValueError(f"{field_name}[{idx}] cannot be a complex number.")
            if elem is None:
                raise ValueError(f"{field_name}[{idx}] cannot be None.")
            if not isinstance(elem, (int, float, np.integer, np.floating)):
                raise ValueError(
                    f"{field_name}[{idx}] must be a real number, got {type(elem).__name__}."
                )
            try:
                val = float(elem)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"{field_name}[{idx}] cannot be converted to float: {exc}"
                ) from exc
            if not math.isfinite(val):
                raise ValueError(f"{field_name}[{idx}] must be finite, got {val}.")
            validated.append(val)

        return validated


class RendezvousResult(BaseModel):
    """Result of two-impulse Clohessy-Wiltshire rendezvous planning and targeting."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    burn_1_dv_cw_ms: list[float] = Field(
        ..., min_length=3, max_length=3, description="Departure burn in CW frame (m/s)."
    )
    burn_2_dv_cw_ms: list[float] = Field(
        ..., min_length=3, max_length=3, description="Arrival burn in CW frame (m/s)."
    )
    total_delta_v_ms: float = Field(
        ..., ge=0.0, description="Scalar sum of departure and arrival burn magnitudes (m/s)."
    )
    transfer_time_s: float = Field(..., gt=0.0, description="Transfer duration in seconds.")

    is_mathematically_solvable: bool = Field(
        ...,
        description=(
            "True if Phi_rv is well-conditioned (kappa <= max_condition_number) "
            "and linear solve succeeded."
        ),
    )
    is_budget_feasible: Optional[bool] = Field(
        default=None,
        description=(
            "Feasibility relative to propellant budget. "
            "None = maneuver was not solved (ill-conditioned or singular); "
            "False = solved maneuver exceeds budget; "
            "True = solved maneuver is within budget."
        ),
    )
    is_feasible: bool = Field(
        ...,
        description=(
            "True if both mathematically solvable and within Delta-V budget "
            "(is_mathematically_solvable and is_budget_feasible is True)."
        ),
    )

    terminal_position_residual_km: list[float] = Field(..., min_length=3, max_length=3)
    terminal_position_error_m: float = Field(..., ge=0.0)
    terminal_velocity_residual_kms: list[float] = Field(..., min_length=3, max_length=3)
    terminal_velocity_error_ms: float = Field(..., ge=0.0)

    condition_number: float = Field(..., ge=1.0)
    epoch_synchronization_applied: bool = Field(default=False)
    scientific_disclaimer: str = Field(
        default=(
            "RESEARCH PROTOTYPE: Clohessy-Wiltshire linearized relative motion model assumes "
            "an unperturbed circular reference orbit. Standoff targets represent nominal "
            "relative positions and do not guarantee collision avoidance. "
            "Not certified for flight operations."
        ),
    )

# ============================================================================
# Day 11: Integration Request and Response Schemas
# ============================================================================


class PropagateSingleFragmentRequest(BaseModel):
    """Request schema for propagating a single synthetic fragment in GCRS."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    fragment: SyntheticFragmentRecord = Field(
        ..., description="Initial state of the synthetic fragment in GCRS"
    )
    config: NumericalPropagationConfig = Field(
        default_factory=NumericalPropagationConfig,
        description="Numerical propagation configuration and safeguards",
    )


class PropagateBatchRequest(BaseModel):
    """Request schema for propagating a batch of synthetic fragments in GCRS."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    fragments: list[SyntheticFragmentRecord] = Field(
        ..., min_length=1, description="List of synthetic fragments sharing common collision epoch"
    )
    config: NumericalPropagationConfig = Field(
        default_factory=NumericalPropagationConfig,
        description="Numerical propagation configuration and safeguards",
    )


class BreakupAndPropagateRequest(BaseModel):
    """Request schema for synthetic breakup and immediate batch propagation."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    scenario: CollisionScenario = Field(
        ..., description="Authoritative collision scenario datum and colliding bodies in GCRS"
    )
    propagation_config: NumericalPropagationConfig = Field(
        default_factory=NumericalPropagationConfig,
        description="Numerical propagation configuration and safeguards",
    )


class BreakupAndPropagateResponse(BaseModel):
    """Response schema combining breakup fragmentation and propagated ephemerides."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    fragmentation: FragmentationResult = Field(
        ..., description="Fragmentation simulation results and momentum metrics"
    )
    trajectories: FragmentTrajectoryBatch = Field(
        ..., description="Numerically integrated ephemerides and batch summary"
    )


class RendezvousPlanRequest(BaseModel):
    """Request schema for two-impulse Clohessy-Wiltshire rendezvous planning."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    contract: RendezvousContract = Field(
        ..., description="Target and chaser initial states contract in GCRS"
    )
    config: RendezvousConfig = Field(
        default_factory=RendezvousConfig,
        description="CW rendezvous configuration and gating thresholds",
    )
    target_trajectory: Optional[FragmentTrajectory] = Field(
        default=None,
        description="Optional ephemeris trajectory for synthetic target epoch synchronization",
    )



class BreakupRemediationRequest(BaseModel):
    """Request schema for end-to-end breakup simulation, target selection, and CW rendezvous."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    scenario: CollisionScenario = Field(
        ..., description="Authoritative collision scenario and colliding parent bodies in GCRS"
    )
    chaser_id: str = Field(
        ..., min_length=1, description="Unique identifier of the remediating chaser spacecraft"
    )
    chaser_epoch_utc: datetime = Field(
        ..., description="Reference epoch for chaser initial state in UTC"
    )
    chaser_gcrs_position_km: list[float] = Field(
        ..., min_length=3, max_length=3, description="Chaser Cartesian position [X, Y, Z] in GCRS (km)"
    )
    chaser_gcrs_velocity_kms: list[float] = Field(
        ..., min_length=3, max_length=3, description="Chaser Cartesian velocity [VX, VY, VZ] in GCRS (km/s)"
    )
    target_epoch_utc: Optional[datetime] = Field(
        default=None,
        description="Target measurement epoch. If None, defaults to chaser_epoch_utc (delta_t = 0)",
    )
    propagation_config: NumericalPropagationConfig = Field(
        default_factory=NumericalPropagationConfig,
        description="Numerical batch propagation configuration and ODE safeguards",
    )
    rendezvous_config: RendezvousConfig = Field(
        default_factory=RendezvousConfig,
        description="Clohessy-Wiltshire rendezvous configuration and feasibility thresholds",
    )
    max_target_eccentricity: float = Field(
        default=0.005,
        gt=0.0,
        le=0.005,
        description="Maximum allowable eccentricity for CW reference orbit linearization (must be <= 0.005)",
    )
    min_target_perigee_km: float = Field(
        default=6478.137,
        ge=6478.137,
        description="Minimum allowable perigee radius in km (Earth radius + 100 km Kármán line)",
    )

    @field_validator("chaser_epoch_utc", "target_epoch_utc")
    @classmethod
    def validate_utc_epochs(cls, v: datetime | None, info: Any) -> datetime | None:
        if v is None:
            return None
        if v.tzinfo is None or v.tzinfo.utcoffset(v) is None:
            raise ValueError(f"{info.field_name} must be timezone-aware (UTC).")
        return v.astimezone(timezone.utc)

    @field_validator("chaser_gcrs_position_km", "chaser_gcrs_velocity_kms", mode="before")
    @classmethod
    def validate_chaser_vectors(cls, v: Any, info: Any) -> list[float]:
        return RendezvousContract.validate_finite_coords(v, info)

    @model_validator(mode="after")
    def validate_configuration_and_window(self) -> "BreakupRemediationRequest":
        # 1. Temporal sequence checks
        collision_utc = self.scenario.collision_epoch.astimezone(timezone.utc)
        chaser_utc = self.chaser_epoch_utc.astimezone(timezone.utc)
        if chaser_utc < collision_utc:
            raise ValueError(
                f"chaser_epoch_utc ({chaser_utc.isoformat()}) cannot precede "
                f"scenario.collision_epoch ({collision_utc.isoformat()})."
            )

        if self.target_epoch_utc is not None:
            target_utc = self.target_epoch_utc.astimezone(timezone.utc)
            if target_utc < collision_utc:
                raise ValueError(
                    f"target_epoch_utc ({target_utc.isoformat()}) cannot precede "
                    f"scenario.collision_epoch ({collision_utc.isoformat()})."
                )
            delta_t = abs((target_utc - chaser_utc).total_seconds())
            if delta_t > self.rendezvous_config.epoch_tolerance_s:
                raise ValueError(
                    f"Epoch discrepancy ({delta_t:.3f} s) exceeds tolerance "
                    f"({self.rendezvous_config.epoch_tolerance_s:.3f} s)."
                )

        # 2. Transfer window coverage check
        t_arrival = chaser_utc + timedelta(seconds=self.rendezvous_config.transfer_time_s)
        propagation_end = collision_utc + timedelta(seconds=self.propagation_config.duration_seconds)
        if t_arrival > propagation_end:
            raise ValueError(
                f"Rendezvous arrival ({t_arrival.isoformat()}) extends beyond propagation duration "
                f"({propagation_end.isoformat()}). Increase propagation_config.duration_seconds."
            )

        # 3. Chaser physical orbit check
        r_vec = np.array(self.chaser_gcrs_position_km, dtype=np.float64)
        v_vec = np.array(self.chaser_gcrs_velocity_kms, dtype=np.float64)
        r_norm = float(np.linalg.norm(r_vec))
        if r_norm <= 6378.137:
            raise ValueError(f"Chaser position radius {r_norm:.3f} km is inside Earth radius (6378.137 km).")

        h_vec = np.cross(r_vec, v_vec)
        h_norm = float(np.linalg.norm(h_vec))
        if h_norm == 0.0:
            raise ValueError("Chaser specific angular momentum is zero (degenerate radial trajectory).")

        v_sq = float(np.dot(v_vec, v_vec))
        energy = 0.5 * v_sq - MU_EARTH_KM3_S2 / r_norm
        if energy >= 0.0:
            raise ValueError(f"Chaser orbit is unbound (specific energy E={energy:.6f} >= 0).")

        a_km = -MU_EARTH_KM3_S2 / (2.0 * energy)
        e_vec = np.cross(v_vec, h_vec) / MU_EARTH_KM3_S2 - r_vec / r_norm
        ecc = float(np.linalg.norm(e_vec))
        if ecc > 0.005:
            raise ValueError(f"Chaser eccentricity e={ecc:.6f} exceeds near-circular limit (0.005).")

        r_p = a_km * (1.0 - ecc)
        if round(r_p, 5) < 6478.137:
            raise ValueError(f"Chaser perigee radius {r_p:.3f} km violates atmospheric entry boundary (6478.137 km).")

        # 4. Sampling step guardrail for rendezvous targeting (Tier 1)
        if self.propagation_config.step_seconds > MAX_TARGETING_KNOT_STEP_SECONDS:
            raise ValueError(
                f"propagation_config.step_seconds ({self.propagation_config.step_seconds:.1f} s) "
                f"exceeds the recommended maximum knot step ({MAX_TARGETING_KNOT_STEP_SECONDS:.1f} s) "
                "for rendezvous targeting. Coarse propagation sampling induces O(h^4) cubic Hermite "
                "interpolation error in orbital curvature that risks exceeding the 1.0 m position cross-check tolerance. "
                "This 60-second limit is a conservative engineering guardrail for near-circular LEO targeting, "
                "not a universal physical boundary. Set propagation_config.step_seconds <= 60.0 s for remediation workflows."
            )

        return self


class BreakupRemediationResponse(BaseModel):
    """Response schema containing end-to-end results from breakup to CW rendezvous solution."""

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True, extra="forbid")

    fragmentation: FragmentationResult = Field(
        ..., description="Fragmentation simulation results and momentum metrics"
    )
    trajectories_summary: FragmentPropagationSummary = Field(
        ..., description="Summary statistics of numerical batch propagation"
    )
    selected_target: SyntheticFragmentRecord = Field(
        ..., description="Highest-mass CW-compliant eligible synthetic fragment targeted for remediation"
    )
    contract: RendezvousContract = Field(
        ..., description="Validated rendezvous contract at chaser epoch"
    )
    rendezvous: RendezvousResult = Field(
        ..., description="Two-impulse CW transfer solution and burn budget evaluation"
    )
    execution_wall_time_s: float = Field(
        ..., ge=0.0, description="Total wall-clock duration of the end-to-end pipeline execution in seconds"
    )
    scientific_disclaimer: str = Field(
        default=(
            "RESEARCH PROTOTYPE: Combines simplified synthetic fragmentation, Cowell/DOP853 J2 "
            "numerical propagation, and linearized Clohessy-Wiltshire relative motion. "
            "Does not account for higher-order gravity, atmospheric drag during transfer, "
            "or active debris tumbling. Not certified for operational flight control."
        ),
        description="Mandatory scientific modeling assumptions and operational disclaimer",
    )
