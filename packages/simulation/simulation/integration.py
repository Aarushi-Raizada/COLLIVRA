"""
ZORBIT - Simulation and Remediation Integration Foundation.

Provides deterministic integration workflows between Day 8 synthetic collision
fragmentation, Day 9 Cowell/DOP853 numerical orbital propagation, and Day 10
Clohessy-Wiltshire two-impulse rendezvous planning.
"""

from datetime import datetime, timedelta, timezone
import math
import time
from typing import Optional

import numpy as np

from .constants import (
    MAX_TARGETING_KNOT_STEP_SECONDS,
    MU_EARTH_KM3_S2,
    R_REENTRY_KM,
)
from .fragmentation import generate_fragments
from .propagation import propagate_fragment_batch
from .rendezvous import (
    ECCENTRICITY_THRESHOLD,
    MIN_PERIGEE_RADIUS_KM,
    _interpolate_trajectory_hermite,
    plan_debris_rendezvous,
    validate_trajectory_knot_spacing,
)
from .schemas import (
    CollisionScenario,
    FragmentationResult,
    FragmentTrajectory,
    FragmentTrajectoryBatch,
    NumericalPropagationConfig,
    BreakupRemediationRequest,
    BreakupRemediationResponse,
    RendezvousContract,
    SyntheticFragmentRecord,
)


def simulate_breakup_and_propagate(
    scenario: CollisionScenario,
    propagation_config: Optional[NumericalPropagationConfig] = None,
) -> tuple[FragmentationResult, FragmentTrajectoryBatch]:
    """Execute synthetic collision breakup and propagate the resulting fragment batch.

    Chains the Day 8 simplified synthetic fragmentation model with the Day 9
    Cowell/DOP853 J2 numerical Cartesian batch propagator.

    Parameters
    ----------
    scenario : CollisionScenario
        Authoritative Day 8 collision scenario containing colliding parent bodies
        and fragmentation configuration in GCRS.
    propagation_config : Optional[NumericalPropagationConfig], default=None
        Day 9 numerical propagator configuration. If omitted, uses defaults.

    Returns
    -------
    tuple[FragmentationResult, FragmentTrajectoryBatch]
        Pair containing:
        - FragmentationResult: Generated fragments, metadata, and conservation metrics.
        - FragmentTrajectoryBatch: Numerically integrated ephemerides and batch summary.
    """
    if not isinstance(scenario, CollisionScenario):
        raise TypeError(f"scenario must be a CollisionScenario, got {type(scenario).__name__}.")

    cfg = propagation_config if propagation_config is not None else NumericalPropagationConfig()
    if not isinstance(cfg, NumericalPropagationConfig):
        raise TypeError(
            f"propagation_config must be a NumericalPropagationConfig, got {type(cfg).__name__}."
        )

    # 1. Generate synthetic fragments from collision scenario
    frag_result = generate_fragments(scenario)

    # 2. Propagate batch numerically
    traj_batch = propagate_fragment_batch(frag_result, config=cfg)

    return frag_result, traj_batch


def select_highest_mass_cw_compliant_fragment(
    fragments: list[SyntheticFragmentRecord],
    trajectory_batch: FragmentTrajectoryBatch,
    max_eccentricity: float = 0.005,
    min_perigee_km: float = 6478.137,
    t0: Optional[datetime] = None,
    t_target: Optional[datetime] = None,
) -> tuple[SyntheticFragmentRecord, FragmentTrajectory]:
    """Deterministically select the highest-mass eligible fragment meeting CW and lifecycle criteria.

    Validates strict 1:1 ID set equality between fragments and batch trajectories,
    filters candidates against numerical lifecycle validity and CW orbital guardrails,
    and returns the eligible fragment with the maximum mass.

    Parameters
    ----------
    fragments : list[SyntheticFragmentRecord]
        Generated synthetic fragments.
    trajectory_batch : FragmentTrajectoryBatch
        Propagated fragment batch containing numerical trajectories.
    max_eccentricity : float, default=0.005
        Maximum allowable osculating eccentricity for CW linearization.
    min_perigee_km : float, default=6478.137
        Minimum allowable osculating perigee radius (100 km altitude above Earth equator).
    t0 : Optional[datetime], default=None
        Chaser epoch. Disqualifies fragments that re-enter at or before t0.
    t_target : Optional[datetime], default=None
        Rendezvous arrival epoch. Disqualifies fragments that re-enter at or before t_target.

    Returns
    -------
    tuple[SyntheticFragmentRecord, FragmentTrajectory]
        The selected eligible SyntheticFragmentRecord and corresponding FragmentTrajectory.

    Raises
    ------
    ValueError
        - If duplicate fragment IDs exist in fragments or trajectories.
        - If the set of fragment IDs does not match trajectory IDs.
        - If no fragments satisfy lifecycle and CW orbital guardrails.
    """
    if not fragments:
        raise ValueError("fragments list cannot be empty.")
    if not trajectory_batch.trajectories:
        raise ValueError("trajectory_batch.trajectories cannot be empty.")

    # 1. Check duplicate IDs in fragments
    frag_ids = [f.fragment_id for f in fragments]
    if len(frag_ids) != len(set(frag_ids)):
        raise ValueError("Duplicate fragment ID encountered in fragments list.")

    # 2. Check duplicate IDs in trajectories
    traj_ids = [t.fragment_id for t in trajectory_batch.trajectories]
    if len(traj_ids) != len(set(traj_ids)):
        raise ValueError("Duplicate fragment ID encountered in trajectory batch.")

    # 3. Assert strict 1:1 set equality
    frag_id_set = set(frag_ids)
    traj_id_set = set(traj_ids)
    if frag_id_set != traj_id_set:
        missing = frag_id_set - traj_id_set
        extra = traj_id_set - frag_id_set
        raise ValueError(
            f"Mismatched fragment IDs between fragments and trajectories: "
            f"missing_in_trajectories={missing}, extra_in_trajectories={extra}."
        )

    traj_map = {t.fragment_id: t for t in trajectory_batch.trajectories}
    eligible_pairs: list[tuple[SyntheticFragmentRecord, FragmentTrajectory]] = []

    # Prepare normalized comparison epochs
    t0_utc = None
    if t0 is not None:
        t0_utc = t0 if t0.tzinfo is not None else t0.replace(tzinfo=timezone.utc)

    tt_utc = None
    if t_target is not None:
        tt_utc = t_target if t_target.tzinfo is not None else t_target.replace(tzinfo=timezone.utc)

    for frag in fragments:
        traj = traj_map[frag.fragment_id]

        # Lifecycle Check 1: Failed trajectories are ineligible
        if traj.status == "FAILED":
            continue

        # Lifecycle Check 2: At least 2 points required for interpolation
        if len(traj.points) < 2:
            continue

        # Lifecycle Check 3: Termination reason & partial trajectory handling
        if traj.status == "PARTIAL":
            if traj.termination_reason != "ATMOSPHERIC_INTERFACE":
                continue
            reentry = traj.reentry_epoch
            if reentry is None:
                continue
            reentry_utc = reentry if reentry.tzinfo is not None else reentry.replace(tzinfo=timezone.utc)
            if t0_utc is not None and t0_utc >= reentry_utc:
                continue
            if tt_utc is not None and tt_utc >= reentry_utc:
                continue
        elif traj.status == "SUCCESS":
            if traj.termination_reason != "COMPLETED":
                continue
        else:
            continue

        # Lifecycle Check 4: Closed interval bracket check (no extrapolation)
        t_start = traj.points[0].epoch
        t_start_utc = t_start if t_start.tzinfo is not None else t_start.replace(tzinfo=timezone.utc)
        t_end = traj.points[-1].epoch
        t_end_utc = t_end if t_end.tzinfo is not None else t_end.replace(tzinfo=timezone.utc)

        if t0_utc is not None and (t0_utc < t_start_utc or t0_utc > t_end_utc):
            continue
        if tt_utc is not None and (tt_utc < t_start_utc or tt_utc > t_end_utc):
            continue

        # CW Orbital Guardrails Evaluation
        r_vec = np.array(frag.position_km, dtype=np.float64)
        v_vec = np.array(frag.velocity_kms, dtype=np.float64)
        r_norm = float(np.linalg.norm(r_vec))
        if r_norm <= 0.0 or not math.isfinite(r_norm):
            continue

        h_vec = np.cross(r_vec, v_vec)
        h_norm = float(np.linalg.norm(h_vec))
        if h_norm <= 0.0 or not math.isfinite(h_norm):
            continue

        v_sq = float(np.dot(v_vec, v_vec))
        energy = 0.5 * v_sq - MU_EARTH_KM3_S2 / r_norm
        if energy >= 0.0 or not math.isfinite(energy):
            continue

        a_semi = -MU_EARTH_KM3_S2 / (2.0 * energy)
        e_vec = (np.cross(v_vec, h_vec) / MU_EARTH_KM3_S2) - (r_vec / r_norm)
        ecc = float(np.linalg.norm(e_vec))
        if ecc > max_eccentricity or not math.isfinite(ecc):
            continue

        r_perigee = a_semi * (1.0 - ecc)
        if round(r_perigee, 5) < min_perigee_km or not math.isfinite(r_perigee):
            continue

        eligible_pairs.append((frag, traj))

    if not eligible_pairs:
        raise ValueError("No CW-compliant, lifecycle-valid fragments found in batch.")

    # Deterministic tie-breaking: sort descending by mass, ascending by fragment_id
    eligible_pairs.sort(key=lambda pair: (-pair[0].mass_kg, pair[0].fragment_id))
    return eligible_pairs[0]


def prepare_fragment_rendezvous_contract(
    fragment: SyntheticFragmentRecord,
    trajectory: FragmentTrajectory,
    chaser_id: str,
    chaser_epoch_utc: datetime,
    chaser_gcrs_position_km: list[float],
    chaser_gcrs_velocity_kms: list[float],
    target_epoch_utc: Optional[datetime] = None,
) -> RendezvousContract:
    """Construct a strictly validated RendezvousContract for a synthetic fragment target.

    Extracts or interpolates target GCRS coordinates at target_epoch_utc (defaults to chaser_epoch_utc)
    from the validated FragmentTrajectory, verifies ID provenance, and builds an immutable
    RendezvousContract.

    Parameters
    ----------
    fragment : SyntheticFragmentRecord
        Target synthetic fragment record.
    trajectory : FragmentTrajectory
        Target numerical trajectory in GCRS.
    chaser_id : str
        Unique identifier of the chaser spacecraft.
    chaser_epoch_utc : datetime
        Reference epoch for chaser initial state.
    chaser_gcrs_position_km : list[float]
        Chaser Cartesian position (X, Y, Z) in km.
    chaser_gcrs_velocity_kms : list[float]
        Chaser Cartesian velocity (VX, VY, VZ) in km/s.
    target_epoch_utc : Optional[datetime], default=None
        Target measurement epoch. If None, set to chaser_epoch_utc (delta_t = 0).

    Returns
    -------
    RendezvousContract
        Strictly validated contract ready for plan_debris_rendezvous().

    Raises
    ------
    ValueError
        - If fragment.fragment_id != trajectory.fragment_id.
        - If trajectory lifecycle validation fails.
        - If extrapolation is required outside trajectory bounds.
        - If target or chaser epoch is at or after atmospheric re-entry.
    """
    if fragment.fragment_id != trajectory.fragment_id:
        raise ValueError(
            f"Fragment ID '{fragment.fragment_id}' does not match "
            f"trajectory ID '{trajectory.fragment_id}'."
        )

    chaser_utc = (
        chaser_epoch_utc
        if chaser_epoch_utc.tzinfo is not None
        else chaser_epoch_utc.replace(tzinfo=timezone.utc)
    )
    target_utc = (
        target_epoch_utc
        if target_epoch_utc is not None
        else chaser_utc
    )
    target_utc = (
        target_utc
        if target_utc.tzinfo is not None
        else target_utc.replace(tzinfo=timezone.utc)
    )

    if trajectory.status == "FAILED":
        raise ValueError(f"Cannot prepare contract from a failed trajectory: {trajectory.fragment_id}")
    if len(trajectory.points) < 2:
        raise ValueError(
            f"Trajectory {trajectory.fragment_id} must have at least 2 points (got {len(trajectory.points)})."
        )

    if trajectory.status == "PARTIAL":
        if trajectory.termination_reason != "ATMOSPHERIC_INTERFACE":
            raise ValueError(
                f"Partial trajectory has unsupported termination reason: {trajectory.termination_reason}"
            )
        reentry = trajectory.reentry_epoch
        if reentry is not None:
            reentry_utc = reentry if reentry.tzinfo is not None else reentry.replace(tzinfo=timezone.utc)
            if chaser_utc >= reentry_utc:
                raise ValueError(
                    f"Chaser epoch ({chaser_utc.isoformat()}) is at or after atmospheric re-entry ({reentry_utc.isoformat()})."
                )
            if target_utc >= reentry_utc:
                raise ValueError(
                    f"Target epoch ({target_utc.isoformat()}) is at or after atmospheric re-entry ({reentry_utc.isoformat()})."
                )

    t_start = trajectory.points[0].epoch
    t_start_utc = t_start if t_start.tzinfo is not None else t_start.replace(tzinfo=timezone.utc)
    t_end = trajectory.points[-1].epoch
    t_end_utc = t_end if t_end.tzinfo is not None else t_end.replace(tzinfo=timezone.utc)

    if target_utc < t_start_utc or target_utc > t_end_utc:
        raise ValueError(
            f"Target epoch {target_utc.isoformat()} is outside trajectory span "
            f"[{t_start_utc.isoformat()}, {t_end_utc.isoformat()}]. Extrapolation is prohibited."
        )

    # Knot interval sampling guardrail & chronological validation for rendezvous targeting (Tier 2)
    validate_trajectory_knot_spacing(trajectory)

    # Hermite cubic interpolation along trajectory knots
    r_target, v_target = _interpolate_trajectory_hermite(trajectory, target_utc)

    return RendezvousContract(
        target_id=fragment.fragment_id,
        chaser_id=chaser_id,
        target_is_synthetic=True,
        target_epoch_utc=target_utc,
        chaser_epoch_utc=chaser_utc,
        target_gcrs_position_km=r_target.tolist(),
        target_gcrs_velocity_kms=v_target.tolist(),
        chaser_gcrs_position_km=list(chaser_gcrs_position_km),
        chaser_gcrs_velocity_kms=list(chaser_gcrs_velocity_kms),
    )


def plan_breakup_remediation(
    request: BreakupRemediationRequest,
) -> BreakupRemediationResponse:
    """Execute end-to-end breakup simulation, target selection, and CW rendezvous planning.

    Sequentially executes:
    1. Breakup simulation & numerical batch propagation via simulate_breakup_and_propagate().
    2. Deterministic selection of the highest-mass CW-compliant fragment via
       select_highest_mass_cw_compliant_fragment(), enforcing full transfer-window
       survival (t_reentry > t_transfer_end).
    3. Trajectory-interpolated RendezvousContract creation via prepare_fragment_rendezvous_contract().
    4. Two-impulse CW rendezvous solve via plan_debris_rendezvous().

    Parameters
    ----------
    request : BreakupRemediationRequest
        Validated request containing collision scenario, chaser state, propagation config,
        and rendezvous config.

    Returns
    -------
    BreakupRemediationResponse
        Complete response containing fragmentation results, batch trajectory summary,
        selected target record, contract, and CW rendezvous burn solution.

    Raises
    ------
    TypeError
        If request is not an instance of BreakupRemediationRequest.
    ValueError
        - If no fragments meet CW eccentricity and perigee criteria.
        - If chaser or target epoch is outside trajectory coverage.
        - If chaser state violates chief orbit physical guardrails.
    """
    start_wall_time = time.perf_counter()

    if not isinstance(request, BreakupRemediationRequest):
        raise TypeError(
            f"request must be a BreakupRemediationRequest, got {type(request).__name__}."
        )

    t0 = request.chaser_epoch_utc.astimezone(timezone.utc)
    target_dt = (
        request.target_epoch_utc.astimezone(timezone.utc)
        if request.target_epoch_utc is not None
        else t0
    )
    t_transfer_end = t0 + timedelta(seconds=request.rendezvous_config.transfer_time_s)

    # 1. Breakup & Batch Propagation
    frag_result, traj_batch = simulate_breakup_and_propagate(
        scenario=request.scenario,
        propagation_config=request.propagation_config,
    )

    # 2. Fragment Selection with Transfer-Window Gating
    selected_frag, selected_traj = select_highest_mass_cw_compliant_fragment(
        fragments=frag_result.fragments,
        trajectory_batch=traj_batch,
        max_eccentricity=request.max_target_eccentricity,
        min_perigee_km=request.min_target_perigee_km,
        t0=t0,
        t_target=t_transfer_end,
    )

    # 3. Contract Preparation (Interpolates Target State at target_dt)
    contract = prepare_fragment_rendezvous_contract(
        fragment=selected_frag,
        trajectory=selected_traj,
        chaser_id=request.chaser_id,
        chaser_epoch_utc=t0,
        chaser_gcrs_position_km=request.chaser_gcrs_position_km,
        chaser_gcrs_velocity_kms=request.chaser_gcrs_velocity_kms,
        target_epoch_utc=target_dt,
    )

    # 4. Plan Two-Impulse CW Rendezvous
    rendezvous_result = plan_debris_rendezvous(
        contract=contract,
        config=request.rendezvous_config,
        target_trajectory=selected_traj,
    )

    total_wall_time = time.perf_counter() - start_wall_time

    return BreakupRemediationResponse(
        fragmentation=frag_result,
        trajectories_summary=traj_batch.summary,
        selected_target=selected_frag,
        contract=contract,
        rendezvous=rendezvous_result,
        execution_wall_time_s=total_wall_time,
    )
