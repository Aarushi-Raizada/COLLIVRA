"""
Conjunction Screening and Risk Classification Engine for ZORBIT.

Identifies potential close approaches (conjunctions) between pairs of tracked orbital
objects over configurable time horizons and computes miss distance, Time of Closest
Approach (TCA), relative position, relative velocity, and screening classifications.

Scientific Guardrails & Mathematical Foundation (AGENTS.md §3.2):
- Conjunction screening calculates geometric close approaches from modelled orbital states.
- It does NOT calculate a formal probability of collision (Pc). Formal Pc requires
  calibrated 3D covariance matrices, which are unavailable in public TLE/OMM records.
- Screening categories (CRITICAL, HIGH, MODERATE, LOW) are preliminary distance-based
  geometric filters, NOT certified collision risks.
- Time of Closest Approach (TCA) is refined using bounded numerical optimization
  on the relative distance trajectory, rather than discrete time-step approximations.
- Multi-satellite failure isolation: failure of one object does not crash screening
  for the remaining valid objects.
"""

from __future__ import annotations

import bisect
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

import numpy as np
from scipy.optimize import minimize_scalar
from sgp4.api import WGS72, Satrec, jday

from orbital_core.frames import (
    FrameTransformationError,
    teme_to_gcrs_cartesian,
    teme_to_itrs_cartesian,
)
from orbital_core.propagation import (
    normalize_utc_datetime,
    record_to_satrec,
)
from orbital_core.schemas import (
    CONJUNCTION_DISCLAIMER,
    ConjunctionEvent,
    ConjunctionScreeningResponse,
    ConjunctionScreeningSummary,
    CoordinateFrame,
    OrbitalObjectRecord,
    ScreeningCategory,
)
from orbital_core.trajectory import (
    _precompute_jdays,
    generate_time_grid,
    propagate_satellite_trajectory,
)

logger = logging.getLogger("orbital_core.conjunction")

SUPPORTED_CONJUNCTION_FRAMES = ("GCRS", "GCRF", "TEME", "ITRS", "ITRF")


def classify_miss_distance(
    miss_distance_km: float,
    threshold_critical_km: float = 1.0,
    threshold_high_km: float = 5.0,
    threshold_moderate_km: float = 10.0,
) -> ScreeningCategory:
    """
    Classify a miss distance into a preliminary geometric screening category.

    Categories:
    - CRITICAL: miss distance < threshold_critical_km (default < 1.0 km)
    - HIGH: threshold_critical_km <= miss distance < threshold_high_km (default 1.0 - 5.0 km)
    - MODERATE: threshold_high_km <= miss distance < threshold_moderate_km (default 5.0 - 10.0 km)
    - LOW: miss distance >= threshold_moderate_km (default >= 10.0 km)

    Scientific Note:
    These categories are preliminary geometric screening filters based on deterministic
    modeled trajectories. They do NOT represent certified collision probabilities.
    """
    if miss_distance_km < threshold_critical_km:
        return "CRITICAL"
    elif miss_distance_km < threshold_high_km:
        return "HIGH"
    elif miss_distance_km < threshold_moderate_km:
        return "MODERATE"
    else:
        return "LOW"


def compute_relative_state(
    pos1: Sequence[float] | np.ndarray,
    vel1: Sequence[float] | np.ndarray,
    pos2: Sequence[float] | np.ndarray,
    vel2: Sequence[float] | np.ndarray,
) -> tuple[tuple[float, float, float], tuple[float, float, float], float, float]:
    """
    Compute relative position, relative velocity, miss distance, and relative closing speed.

    Formulation:
        r_rel = r_2 - r_1
        v_rel = v_2 - v_1
        d = ||r_rel||
        v_rel_speed = ||v_rel||

    Units:
        Position: km
        Velocity: km/s
        Distance: km
        Speed: km/s

    Args:
        pos1: Cartesian position (x, y, z) of object 1 in km.
        vel1: Cartesian velocity (vx, vy, vz) of object 1 in km/s.
        pos2: Cartesian position (x, y, z) of object 2 in km.
        vel2: Cartesian velocity (vx, vy, vz) of object 2 in km/s.

    Returns:
        (relative_position_km, relative_velocity_kms, miss_distance_km, relative_speed_kms)
    """
    r1 = np.asarray(pos1, dtype=np.float64)
    v1 = np.asarray(vel1, dtype=np.float64)
    r2 = np.asarray(pos2, dtype=np.float64)
    v2 = np.asarray(vel2, dtype=np.float64)

    r_rel = r2 - r1
    v_rel = v2 - v1
    dist = float(np.linalg.norm(r_rel))
    rel_speed = float(np.linalg.norm(v_rel))

    return (
        (float(r_rel[0]), float(r_rel[1]), float(r_rel[2])),
        (float(v_rel[0]), float(v_rel[1]), float(v_rel[2])),
        dist,
        rel_speed,
    )


def _hermite_interpolate_state(
    pos_a: np.ndarray,
    vel_a: np.ndarray,
    pos_b: np.ndarray,
    vel_b: np.ndarray,
    tau: float,
    dt: float,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Cubic Hermite interpolation of position and velocity over interval [0, dt].

    Given endpoint state vectors (pos_a, vel_a) at tau=0 and (pos_b, vel_b) at tau=dt,
    evaluates interpolated position P(tau) and velocity P'(tau).
    """
    if dt <= 0.0 or tau <= 0.0:
        return pos_a.copy(), vel_a.copy()
    if tau >= dt:
        return pos_b.copy(), vel_b.copy()

    s = tau / dt
    s2 = s * s
    s3 = s2 * s

    # Hermite basis functions for position
    h00 = 2.0 * s3 - 3.0 * s2 + 1.0
    h10 = s3 - 2.0 * s2 + s
    h01 = -2.0 * s3 + 3.0 * s2
    h11 = s3 - s2

    pos = h00 * pos_a + h10 * dt * vel_a + h01 * pos_b + h11 * dt * vel_b

    # Derivatives for velocity
    dh00 = (6.0 * s2 - 6.0 * s) / dt
    dh10 = 3.0 * s2 - 4.0 * s + 1.0
    dh01 = (-6.0 * s2 + 6.0 * s) / dt
    dh11 = 3.0 * s2 - 2.0 * s

    vel = dh00 * pos_a + dh10 * vel_a + dh01 * pos_b + dh11 * vel_b

    return pos, vel


def _evaluate_sat_state_at_epoch(
    sat: Satrec | None,
    pos_a: np.ndarray,
    vel_a: np.ndarray,
    pos_b: np.ndarray,
    vel_b: np.ndarray,
    t_eval: datetime,
    t_a: datetime,
    dt_bracket: float,
    target_frame: str,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Evaluate state vector for a satellite at t_eval within [t_a, t_b].
    Prefers direct SGP4 propagation if Satrec is available, otherwise uses Hermite interpolation.
    Coordinates are returned in target_frame.
    """
    tau = (t_eval - t_a).total_seconds()
    if sat is not None:
        second_float = t_eval.second + t_eval.microsecond / 1_000_000.0
        jd, fr = jday(
            t_eval.year,
            t_eval.month,
            t_eval.day,
            t_eval.hour,
            t_eval.minute,
            second_float,
        )
        err, r_teme, v_teme = sat.sgp4(jd, fr)
        if err == 0:
            pos_t = (float(r_teme[0]), float(r_teme[1]), float(r_teme[2]))
            vel_t = (float(v_teme[0]), float(v_teme[1]), float(v_teme[2]))
            if target_frame == "TEME":
                return np.array(pos_t), np.array(vel_t)
            elif target_frame in ("GCRS", "GCRF"):
                p_out, v_out = teme_to_gcrs_cartesian(pos_t, vel_t, t_eval)
                return np.array(p_out), np.array(v_out)
            elif target_frame in ("ITRS", "ITRF"):
                p_out, v_out = teme_to_itrs_cartesian(pos_t, vel_t, t_eval)
                return np.array(p_out), np.array(v_out)

    # Fallback to cubic Hermite polynomial interpolation in target frame
    return _hermite_interpolate_state(pos_a, vel_a, pos_b, vel_b, tau, dt_bracket)


def _extract_object_identity(item: Any) -> tuple[str, str]:
    """
    Extract stable (id_type, normalized_id) for an orbital object.

    Primary identity: normalized NORAD catalog ID.
    Secondary identity: normalized OBJECT_ID (COSPAR international designator).
    OBJECT_NAME is not globally unique and is never used as an identity fallback.
    Records lacking both reliable identifiers receive per-record unique identity.
    """
    if isinstance(item, Satrec):
        satnum_str = getattr(item, "satnum_str", None)
        if satnum_str and str(satnum_str).strip() and str(satnum_str).strip() != "0":
            return ("NORAD", str(satnum_str).strip())
        satnum = getattr(item, "satnum", None)
        if satnum is not None and str(satnum).strip() and str(satnum).strip() != "0":
            return ("NORAD", str(satnum).strip())
        return ("RECORD", str(id(item)))
    elif isinstance(item, OrbitalObjectRecord):
        if item.norad_cat_id and str(item.norad_cat_id).strip():
            return ("NORAD", str(item.norad_cat_id).strip())
        if item.object_id and str(item.object_id).strip():
            return ("OBJECT_ID", str(item.object_id).strip())
        return ("RECORD", str(id(item)))
    elif isinstance(item, dict):
        norad = item.get("NORAD_CAT_ID")
        if norad is not None and str(norad).strip() and str(norad).strip() != "None":
            return ("NORAD", str(norad).strip())
        obj_id = item.get("OBJECT_ID")
        if obj_id is not None and str(obj_id).strip() and str(obj_id).strip() != "None":
            return ("OBJECT_ID", str(obj_id).strip())
        return ("RECORD", str(id(item)))
    return ("RECORD", str(id(item)))


def _assert_no_conflicting_records(item1: Any, item2: Any, id_key: tuple[str, str]) -> None:
    """
    Check if two records sharing the same catalog identity have conflicting orbital elements.
    Raises ValueError if elements or epochs conflict, preventing silent arbitrary selection.
    """

    def extract_params(item: Any) -> dict[str, Any] | None:
        if isinstance(item, OrbitalObjectRecord):
            return {
                "epoch": item.epoch,
                "mean_motion": float(item.mean_motion),
                "eccentricity": float(item.eccentricity),
                "inclination": float(item.inclination),
                "ra_of_asc_node": float(item.ra_of_asc_node),
                "arg_of_pericenter": float(item.arg_of_pericenter),
                "mean_anomaly": float(item.mean_anomaly),
            }
        elif isinstance(item, dict):
            try:
                rec = OrbitalObjectRecord.from_omm_dict(item)
                return {
                    "epoch": rec.epoch,
                    "mean_motion": float(rec.mean_motion),
                    "eccentricity": float(rec.eccentricity),
                    "inclination": float(rec.inclination),
                    "ra_of_asc_node": float(rec.ra_of_asc_node),
                    "arg_of_pericenter": float(rec.arg_of_pericenter),
                    "mean_anomaly": float(rec.mean_anomaly),
                }
            except Exception:
                # Direct dictionary extraction when NORAD_CAT_ID is absent (e.g. OBJECT_ID-only)
                epoch_val = item.get("EPOCH")
                if epoch_val is not None and "MEAN_MOTION" in item and "ECCENTRICITY" in item:
                    try:
                        if isinstance(epoch_val, datetime):
                            ep = (
                                epoch_val.replace(tzinfo=timezone.utc)
                                if epoch_val.tzinfo is None
                                else epoch_val.astimezone(timezone.utc)
                            )
                        elif isinstance(epoch_val, str):
                            s = epoch_val.strip()
                            if s.endswith("Z"):
                                s = s[:-1] + "+00:00"
                            dt = datetime.fromisoformat(s)
                            ep = (
                                dt.replace(tzinfo=timezone.utc)
                                if dt.tzinfo is None
                                else dt.astimezone(timezone.utc)
                            )
                        else:
                            ep = None

                        if ep is not None:
                            return {
                                "epoch": ep,
                                "mean_motion": float(item["MEAN_MOTION"]),
                                "eccentricity": float(item["ECCENTRICITY"]),
                                "inclination": float(item.get("INCLINATION", 0.0)),
                                "ra_of_asc_node": float(item.get("RA_OF_ASC_NODE", 0.0)),
                                "arg_of_pericenter": float(item.get("ARG_OF_PERICENTER", 0.0)),
                                "mean_anomaly": float(item.get("MEAN_ANOMALY", 0.0)),
                            }
                    except Exception:
                        return None
                return None
        elif isinstance(item, Satrec):
            return {
                "jdsatepoch": getattr(item, "jdsatepoch", 0.0),
                "jdsatepochF": getattr(item, "jdsatepochF", 0.0),
                "no_kozai": getattr(item, "no_kozai", 0.0),
                "ecco": getattr(item, "ecco", 0.0),
                "inclo": getattr(item, "inclo", 0.0),
            }
        return None

    p1 = extract_params(item1)
    p2 = extract_params(item2)

    if p1 is not None and p2 is not None:
        if "epoch" in p1 and "epoch" in p2:
            dt_diff = abs((p1["epoch"] - p2["epoch"]).total_seconds())
            if dt_diff > 1.0:
                raise ValueError(
                    f"Conflicting duplicate records detected for catalog identity '{id_key[1]}': "
                    f"differing epochs ({p1['epoch'].isoformat()} vs {p2['epoch'].isoformat()})"
                )
            for k in [
                "mean_motion",
                "eccentricity",
                "inclination",
                "ra_of_asc_node",
                "arg_of_pericenter",
                "mean_anomaly",
            ]:
                if abs(p1[k] - p2[k]) > 1e-4:
                    raise ValueError(
                        f"Conflicting duplicate records detected for identity '{id_key[1]}': "
                        f"differing parameter '{k}' ({p1[k]} vs {p2[k]})"
                    )
        elif "jdsatepoch" in p1 and "jdsatepoch" in p2:
            epoch_diff = abs(
                (p1["jdsatepoch"] + p1["jdsatepochF"]) - (p2["jdsatepoch"] + p2["jdsatepochF"])
            )
            if epoch_diff > 1e-5:
                raise ValueError(
                    f"Conflicting duplicate records detected for Satrec '{id_key[1]}': "
                    "differing epochs"
                )
            for k in ["no_kozai", "ecco", "inclo"]:
                if abs(float(p1[k]) - float(p2[k])) > 1e-5:
                    raise ValueError(
                        f"Conflicting duplicate records detected for Satrec '{id_key[1]}': "
                        f"differing parameter '{k}'"
                    )


def _estimate_pair_max_relative_speed(
    obj1_item: Any,
    obj2_item: Any,
    vel1_arr: list[tuple[float, float, float]] | None = None,
    vel2_arr: list[tuple[float, float, float]] | None = None,
) -> float:
    """
    Derive an upper bound for relative closing speed [km/s].

    Scientific Guardrail & Mathematical Safety (AGENTS.md §1 & §3.2):
    - Two-body vis-viva estimates based on mean orbital elements (even with heuristic 15% margins)
      are not mathematically certified upper bounds on instantaneous SGP4 velocities under
      J2-J4 geopotential perturbations, atmospheric drag, or solar-lunar third-body gravity.
    - Discrete sampled velocities also cannot guarantee continuous velocity bounds between epochs.
    - To eliminate the risk of unsafe interval pruning and missed candidate close approaches,
      this function returns float("inf").
    - Returning infinity ensures that distance-based candidate pruning is disabled:
      search_cutoff = threshold_km + inf * dt = inf.
      Every discrete local minimum across the screening interval is preserved and forwarded
      to bounded continuous numerical optimization.

    Performance Implications:
    - Because distance-based pruning is disabled, all discrete local minima are evaluated
      for continuous TCA refinement via bounded Brent minimization rather than being
      pruned early by an empirical cutoff. For standard catalogs, discrete local minima
      are naturally sparse, introducing minimal computational overhead while providing
      mathematical safety against false-negative candidate drops.
    """
    return float("inf")


def _refine_tca_single_subinterval(
    sat1: Satrec | None,
    sat2: Satrec | None,
    pos1_a: np.ndarray,
    vel1_a: np.ndarray,
    pos1_b: np.ndarray,
    vel1_b: np.ndarray,
    pos2_a: np.ndarray,
    vel2_a: np.ndarray,
    pos2_b: np.ndarray,
    vel2_b: np.ndarray,
    t_a: datetime,
    t_b: datetime,
    target_frame: str,
) -> tuple[datetime, tuple[float, float, float], tuple[float, float, float], float, float, str]:
    """
    Refine TCA within a single subinterval [t_a, t_b] using bounded scalar optimization.
    """
    dt_bracket = (t_b - t_a).total_seconds()
    if dt_bracket <= 0.0:
        r_rel, v_rel, d, v_speed = compute_relative_state(pos1_a, vel1_a, pos2_a, vel2_a)
        return t_a, r_rel, v_rel, d, v_speed, "SINGLE_POINT"

    has_both_sats = sat1 is not None and sat2 is not None

    def distance_objective(tau: float) -> float:
        t_eval = t_a + timedelta(seconds=tau)
        if has_both_sats:
            second_float = t_eval.second + t_eval.microsecond / 1_000_000.0
            jd, fr = jday(
                t_eval.year,
                t_eval.month,
                t_eval.day,
                t_eval.hour,
                t_eval.minute,
                second_float,
            )
            e1, r1, _ = sat1.sgp4(jd, fr)  # type: ignore[union-attr]
            e2, r2, _ = sat2.sgp4(jd, fr)  # type: ignore[union-attr]
            if e1 == 0 and e2 == 0:
                dx = r2[0] - r1[0]
                dy = r2[1] - r1[1]
                dz = r2[2] - r1[2]
                return math.sqrt(dx * dx + dy * dy + dz * dz)

        # Fallback to cubic Hermite interpolant across [t_a, t_b]
        p1, _ = _hermite_interpolate_state(pos1_a, vel1_a, pos1_b, vel1_b, tau, dt_bracket)
        p2, _ = _hermite_interpolate_state(pos2_a, vel2_a, pos2_b, vel2_b, tau, dt_bracket)
        return float(np.linalg.norm(p2 - p1))

    d_start = distance_objective(0.0)
    d_end = distance_objective(dt_bracket)

    res = minimize_scalar(
        distance_objective,
        bounds=(0.0, dt_bracket),
        method="bounded",
        options={"xatol": 1e-4, "maxiter": 100},
    )

    best_tau = float(res.x) if res.success else 0.0
    best_d = float(res.fun) if res.success else d_start

    if d_start < best_d:
        best_tau = 0.0
        best_d = d_start
    if d_end < best_d:
        best_tau = dt_bracket
        best_d = d_end

    refined_tca = t_a + timedelta(seconds=best_tau)

    p1_tca, v1_tca = _evaluate_sat_state_at_epoch(
        sat1, pos1_a, vel1_a, pos1_b, vel1_b, refined_tca, t_a, dt_bracket, target_frame
    )
    p2_tca, v2_tca = _evaluate_sat_state_at_epoch(
        sat2, pos2_a, vel2_a, pos2_b, vel2_b, refined_tca, t_a, dt_bracket, target_frame
    )

    r_rel, v_rel, miss_d, rel_speed = compute_relative_state(p1_tca, v1_tca, p2_tca, v2_tca)
    method_name = "SGP4_NUMERICAL_MINIMIZATION" if has_both_sats else "HERMITE_CUBIC_REFINEMENT"

    return refined_tca, r_rel, v_rel, miss_d, rel_speed, method_name


def _refine_tca_in_bracket(
    sat1: Satrec | None,
    sat2: Satrec | None,
    pos1_a: np.ndarray,
    vel1_a: np.ndarray,
    pos1_b: np.ndarray,
    vel1_b: np.ndarray,
    pos2_a: np.ndarray,
    vel2_a: np.ndarray,
    pos2_b: np.ndarray,
    vel2_b: np.ndarray,
    t_a: datetime,
    t_b: datetime,
    target_frame: str,
    pos1_m: np.ndarray | None = None,
    vel1_m: np.ndarray | None = None,
    pos2_m: np.ndarray | None = None,
    vel2_m: np.ndarray | None = None,
    t_m: datetime | None = None,
) -> tuple[datetime, tuple[float, float, float], tuple[float, float, float], float, float, str]:
    """
    Refine Time of Closest Approach within bracket [t_a, t_b] using bounded scalar optimization.

    When Satrec is unavailable (Hermite fallback) and a midpoint t_m is provided, evaluates
    the two adjacent subintervals [t_a, t_m] and [t_m, t_b] independently, utilizing both
    position and velocity at both endpoints of each subinterval without discarding the midpoint.
    """
    if (
        t_m is not None
        and pos1_m is not None
        and pos2_m is not None
        and vel1_m is not None
        and vel2_m is not None
    ):
        res1 = _refine_tca_single_subinterval(
            sat1=sat1,
            sat2=sat2,
            pos1_a=pos1_a,
            vel1_a=vel1_a,
            pos1_b=pos1_m,
            vel1_b=vel1_m,
            pos2_a=pos2_a,
            vel2_a=vel2_a,
            pos2_b=pos2_m,
            vel2_b=vel2_m,
            t_a=t_a,
            t_b=t_m,
            target_frame=target_frame,
        )
        res2 = _refine_tca_single_subinterval(
            sat1=sat1,
            sat2=sat2,
            pos1_a=pos1_m,
            vel1_a=vel1_m,
            pos1_b=pos1_b,
            vel1_b=vel1_b,
            pos2_a=pos2_m,
            vel2_a=vel2_m,
            pos2_b=pos2_b,
            vel2_b=vel2_b,
            t_a=t_m,
            t_b=t_b,
            target_frame=target_frame,
        )
        return res1 if res1[3] <= res2[3] else res2

    return _refine_tca_single_subinterval(
        sat1=sat1,
        sat2=sat2,
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
        target_frame=target_frame,
    )


def _find_candidate_minima_indices(
    distances: list[float],
    threshold_km: float,
    step_seconds: float = 60.0,
    max_relative_speed_kms: float = float("inf"),
) -> list[int]:
    """
    Identify discrete time-grid indices corresponding to local minima in separation distance.
    Handles beginning, interior, and end-of-window minima.

    Mathematical Bracketing Detail:
    - For interior samples, the nearest sample to a continuous minimum is at most half a
      sampling interval away (tau <= 0.5 * step_seconds).
    - At the screening-window boundaries [t0, t1] and [t_{n-2}, t_{n-1}], the nearest sample
      may be up to a full sampling interval away (tau <= 1.0 * step_seconds).
    - Accounts for high closing velocities where discrete samples exceed threshold while
      the continuous minimum drops below threshold.
    """
    n = len(distances)
    if n == 0:
        return []

    search_cutoff_interior = (
        float("inf")
        if math.isinf(max_relative_speed_kms)
        else threshold_km + max_relative_speed_kms * (0.5 * step_seconds)
    )

    search_cutoff_boundary = (
        float("inf")
        if math.isinf(max_relative_speed_kms)
        else threshold_km + max_relative_speed_kms * (1.0 * step_seconds)
    )

    if n == 1:
        return [0] if distances[0] <= threshold_km else []

    if n == 2:
        if min(distances[0], distances[1]) <= search_cutoff_boundary:
            return [0]
        return []

    candidate_indices: list[int] = []

    # 1. Beginning of window [t0, t1]
    if distances[0] <= search_cutoff_boundary:
        if distances[0] < distances[1] or (
            distances[0] == distances[1] and distances[0] <= threshold_km
        ):
            candidate_indices.append(0)

    # 2. Interior local minima
    for k in range(1, n - 1):
        d_prev = distances[k - 1]
        d_curr = distances[k]
        d_next = distances[k + 1]

        if d_curr <= search_cutoff_interior:
            if d_curr <= d_prev and d_curr <= d_next:
                if d_curr < d_prev or d_curr < d_next:
                    candidate_indices.append(k)
                elif d_curr <= threshold_km and not candidate_indices:
                    candidate_indices.append(k)

    # 3. End of window [t_{n-2}, t_{n-1}]
    if distances[-1] <= search_cutoff_boundary:
        if distances[-1] < distances[-2]:
            if n - 1 not in candidate_indices:
                candidate_indices.append(n - 1)

    return candidate_indices


class _RefinedEventCandidate:
    """Internal candidate representation retaining bracket boundaries for deduplication."""

    __slots__ = ("event", "bracket_start", "bracket_end", "candidate_idx")

    def __init__(
        self,
        event: ConjunctionEvent,
        bracket_start: datetime,
        bracket_end: datetime,
        candidate_idx: int,
    ) -> None:
        self.event = event
        self.bracket_start = bracket_start
        self.bracket_end = bracket_end
        self.candidate_idx = candidate_idx


def _evaluate_relative_distance(
    t_eval: datetime,
    sat1: Satrec | None,
    sat2: Satrec | None,
    common_epochs: list[datetime],
    pos1_arr: list[tuple[float, float, float]],
    vel1_arr: list[tuple[float, float, float]],
    pos2_arr: list[tuple[float, float, float]],
    vel2_arr: list[tuple[float, float, float]],
) -> float:
    """
    Evaluate Euclidean separation distance between two orbital objects at t_eval.
    Prefers continuous SGP4 propagation when Satrec objects are present,
    falling back to cubic Hermite spline interpolation over the discrete time grid.
    """
    if sat1 is not None and sat2 is not None:
        second_float = t_eval.second + t_eval.microsecond / 1_000_000.0
        jd, fr = jday(
            t_eval.year,
            t_eval.month,
            t_eval.day,
            t_eval.hour,
            t_eval.minute,
            second_float,
        )
        e1, r1, _ = sat1.sgp4(jd, fr)
        e2, r2, _ = sat2.sgp4(jd, fr)
        if e1 == 0 and e2 == 0:
            dx = float(r2[0] - r1[0])
            dy = float(r2[1] - r1[1])
            dz = float(r2[2] - r1[2])
            return math.sqrt(dx * dx + dy * dy + dz * dz)

    # Fallback to cubic Hermite polynomial interpolation over the relevant time bracket
    n_epochs = len(common_epochs)
    if n_epochs == 0:
        return 0.0
    if n_epochs == 1 or t_eval <= common_epochs[0]:
        dx = pos2_arr[0][0] - pos1_arr[0][0]
        dy = pos2_arr[0][1] - pos1_arr[0][1]
        dz = pos2_arr[0][2] - pos1_arr[0][2]
        return math.sqrt(dx * dx + dy * dy + dz * dz)
    if t_eval >= common_epochs[-1]:
        dx = pos2_arr[-1][0] - pos1_arr[-1][0]
        dy = pos2_arr[-1][1] - pos1_arr[-1][1]
        dz = pos2_arr[-1][2] - pos1_arr[-1][2]
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    k = bisect.bisect_right(common_epochs, t_eval) - 1
    k = max(0, min(n_epochs - 2, k))

    t_k0 = common_epochs[k]
    t_k1 = common_epochs[k + 1]
    dt_bracket = (t_k1 - t_k0).total_seconds()
    tau = (t_eval - t_k0).total_seconds()

    p1, _ = _hermite_interpolate_state(
        np.array(pos1_arr[k]),
        np.array(vel1_arr[k]),
        np.array(pos1_arr[k + 1]),
        np.array(vel1_arr[k + 1]),
        tau,
        dt_bracket,
    )
    p2, _ = _hermite_interpolate_state(
        np.array(pos2_arr[k]),
        np.array(vel2_arr[k]),
        np.array(pos2_arr[k + 1]),
        np.array(vel2_arr[k + 1]),
        tau,
        dt_bracket,
    )
    diff = p2 - p1
    return float(np.linalg.norm(diff))


def _check_intervening_maximum(
    t1: datetime,
    t2: datetime,
    d1: float,
    d2: float,
    sat1: Satrec | None,
    sat2: Satrec | None,
    common_epochs: list[datetime],
    pos1_arr: list[tuple[float, float, float]],
    vel1_arr: list[tuple[float, float, float]],
    pos2_arr: list[tuple[float, float, float]],
    vel2_arr: list[tuple[float, float, float]],
    threshold_km: float,
    prominence_threshold_km: float = 0.001,
) -> bool:
    """
    Evaluate whether a demonstrable local maximum exists in the continuous relative distance
    curve between two refined candidate minima at t1 and t2 (t1 < t2).

    Returns True if an intervening maximum exists with crest prominence above
    prominence_threshold_km (or exceeding threshold_km), demonstrating that t1 and t2
    are physically distinct encounters rather than duplicate refinements of the same basin.
    """
    dt_total = (t2 - t1).total_seconds()
    if dt_total < 0.01:
        # Time separation is below numerical optimization resolution
        return False

    def get_d(tau_sec: float) -> float:
        t_sample = t1 + timedelta(seconds=tau_sec)
        return _evaluate_relative_distance(
            t_sample,
            sat1,
            sat2,
            common_epochs,
            pos1_arr,
            vel1_arr,
            pos2_arr,
            vel2_arr,
        )

    # 1. Discrete probe across interval
    n_samples = 21
    sample_taus = [dt_total * (i / (n_samples - 1)) for i in range(n_samples)]
    sample_dists = [get_d(tau) for tau in sample_taus]
    max_d = max(sample_dists)

    # 2. Refine maximum via bounded optimization on -d(tau)
    try:
        opt_res = minimize_scalar(
            lambda tau: -get_d(tau),
            bounds=(0.0, dt_total),
            method="bounded",
            options={"xatol": 1e-4, "maxiter": 50},
        )
        if opt_res.success:
            max_d = max(max_d, -float(opt_res.fun))
    except Exception:
        pass

    prominence_1 = max_d - d1
    prominence_2 = max_d - d2
    crest_prominence = min(prominence_1, prominence_2)

    if crest_prominence >= prominence_threshold_km or (
        max_d > threshold_km and (d1 <= threshold_km and d2 <= threshold_km)
    ):
        return True

    return False


def screen_conjunctions(
    satellites: Sequence[OrbitalObjectRecord | dict[str, Any] | Satrec],
    start_time: datetime | str,
    end_time: datetime | str,
    step_seconds: float = 60.0,
    threshold_km: float = 10.0,
    target_frame: CoordinateFrame | str = "GCRS",
    threshold_critical_km: float = 1.0,
    threshold_high_km: float = 5.0,
    threshold_moderate_km: float = 10.0,
    gravconst: int = WGS72,
    refine_tca: bool = True,
    unresolved_norad_ids: Sequence[int] | None = None,
    total_requested_objects: int | None = None,
) -> ConjunctionScreeningResponse:
    """
    Screen multiple orbital objects for close-approach conjunction events.

    Execution Pipeline:
    1. Validates time window, step, threshold, and coordinate frame parameters upfront.
    2. Deduplicates input objects by stable catalog identity, rejecting conflicting duplicates.
    3. Batch-propagates valid satellites onto a common time grid into target_frame.
    4. Evaluates unique unordered pairs {i, j} (i < j) with defensive self-pair guards.
    5. Derives conservative per-pair relative velocity bounds without arbitrary speed limits.
    6. Identifies candidate encounter brackets covering interior and boundary intervals.
    7. Refines TCA via bounded optimization (with midpoint Hermite fallback).
    8. Deduplicates duplicate refinements of the same minimum via numerical convergence.
    9. Classifies miss distance into preliminary categories (CRITICAL, HIGH, MODERATE, LOW).
    10. Returns structured ConjunctionScreeningResponse with summary metrics and events.
    """
    t_start_wall = time.perf_counter()

    # Parameter validation
    start_dt = normalize_utc_datetime(start_time)
    end_dt = normalize_utc_datetime(end_time)

    if end_dt < start_dt:
        raise ValueError(
            f"end_time ({end_dt.isoformat()}) must be >= start_time ({start_dt.isoformat()})"
        )
    if not math.isfinite(step_seconds) or step_seconds <= 0.0:
        raise ValueError(
            f"step_seconds must be a finite, strictly positive number (> 0.0), got {step_seconds}"
        )
    if not math.isfinite(threshold_km) or threshold_km <= 0.0:
        raise ValueError(
            f"threshold_km must be a finite, strictly positive number (> 0.0), got {threshold_km}"
        )

    for name, val in [
        ("threshold_critical_km", threshold_critical_km),
        ("threshold_high_km", threshold_high_km),
        ("threshold_moderate_km", threshold_moderate_km),
    ]:
        if not math.isfinite(val) or val <= 0.0:
            raise ValueError(f"{name} must be finite and > 0.0, got {val}")

    if not (threshold_critical_km < threshold_high_km <= threshold_moderate_km):
        raise ValueError(
            "Classification thresholds must satisfy: "
            "0 < threshold_critical_km < threshold_high_km <= threshold_moderate_km"
        )

    frame_str = str(target_frame).strip().upper()
    if frame_str not in SUPPORTED_CONJUNCTION_FRAMES:
        raise FrameTransformationError(
            f"Unsupported target frame '{target_frame}'. "
            f"Supported frames: {', '.join(SUPPORTED_CONJUNCTION_FRAMES)}."
        )

    unresolved_list = list(unresolved_norad_ids or [])
    total_objects_in = (
        total_requested_objects
        if total_requested_objects is not None
        else (len(satellites) + len(unresolved_list))
    )

    # 1. Deduplicate input satellites by catalog identity, rejecting conflicting duplicates
    deduped_satellites: list[OrbitalObjectRecord | dict[str, Any] | Satrec] = []
    seen_identities: dict[tuple[str, str], Any] = {}

    for sat_item in satellites:
        id_key = _extract_object_identity(sat_item)
        if id_key[0] not in ("MEMORY", "RECORD") and id_key in seen_identities:
            _assert_no_conflicting_records(seen_identities[id_key], sat_item, id_key)
            logger.info("Deduplicating identical duplicate satellite record: %s", id_key)
            continue
        seen_identities[id_key] = sat_item
        deduped_satellites.append(sat_item)

    if len(deduped_satellites) < 2:
        return ConjunctionScreeningResponse(
            summary=ConjunctionScreeningSummary(
                total_objects=total_objects_in,
                resolved_objects_count=len(deduped_satellites),
                unresolved_norad_ids=unresolved_list,
                total_pairs_considered=0,
                total_events=0,
                critical_count=0,
                high_count=0,
                moderate_count=0,
                low_count=0,
                start_time=start_dt,
                end_time=end_dt,
                step_seconds=step_seconds,
                threshold_km=threshold_km,
                target_frame=frame_str,  # type: ignore[arg-type]
                processed_at=datetime.now(timezone.utc),
                execution_time_seconds=time.perf_counter() - t_start_wall,
                failed_objects_count=0,
            ),
            events=[],
            unresolved_norad_ids=unresolved_list,
            disclaimer=CONJUNCTION_DISCLAIMER,
        )

    # Generate shared time grid and precomputed Julian dates once
    time_grid = generate_time_grid(start_dt, end_dt, step_seconds)
    precomputed_jdays = _precompute_jdays(time_grid)

    # 2. Propagate all unique satellites into common target frame
    valid_sat_data: list[dict[str, Any]] = []
    failed_objects_count = 0

    for sat_item in deduped_satellites:
        try:
            traj = propagate_satellite_trajectory(
                record_or_satrec=sat_item,
                start_time=start_dt,
                end_time=end_dt,
                step_seconds=step_seconds,
                target_frame=frame_str,
                gravconst=gravconst,
                raise_on_error=False,
                time_grid=time_grid,
                precomputed_jday=precomputed_jdays,
            )

            if traj.status == "FAILED" or len(traj.points) == 0:
                logger.warning(
                    "Skipping failed satellite %s in conjunction screening: %s",
                    traj.object_id,
                    traj.error_message,
                )
                failed_objects_count += 1
                continue

            satrec_obj: Satrec | None = None
            if isinstance(sat_item, Satrec):
                satrec_obj = sat_item
            elif isinstance(sat_item, OrbitalObjectRecord):
                try:
                    satrec_obj = record_to_satrec(sat_item, gravconst=gravconst)
                except Exception:
                    satrec_obj = None
            elif isinstance(sat_item, dict):
                try:
                    rec = OrbitalObjectRecord.from_omm_dict(sat_item)
                    satrec_obj = record_to_satrec(rec, gravconst=gravconst)
                except Exception:
                    satrec_obj = None

            epoch_map: dict[
                datetime, tuple[tuple[float, float, float], tuple[float, float, float]]
            ] = {pt.epoch: (pt.position_km, pt.velocity_kms) for pt in traj.points}

            valid_sat_data.append(
                {
                    "object_id": traj.object_id,
                    "object_name": traj.object_name,
                    "norad_cat_id": traj.norad_cat_id,
                    "identity_key": _extract_object_identity(sat_item),
                    "original_item": sat_item,
                    "satrec": satrec_obj,
                    "trajectory": traj,
                    "epoch_map": epoch_map,
                }
            )
        except Exception as err:
            logger.warning("Satellite initialization failed in screening: %s", err)
            failed_objects_count += 1

    num_valid = len(valid_sat_data)
    total_pairs = num_valid * (num_valid - 1) // 2

    if num_valid < 2:
        return ConjunctionScreeningResponse(
            summary=ConjunctionScreeningSummary(
                total_objects=total_objects_in,
                resolved_objects_count=num_valid,
                unresolved_norad_ids=unresolved_list,
                total_pairs_considered=total_pairs,
                total_events=0,
                critical_count=0,
                high_count=0,
                moderate_count=0,
                low_count=0,
                start_time=start_dt,
                end_time=end_dt,
                step_seconds=step_seconds,
                threshold_km=threshold_km,
                target_frame=frame_str,  # type: ignore[arg-type]
                processed_at=datetime.now(timezone.utc),
                execution_time_seconds=time.perf_counter() - t_start_wall,
                failed_objects_count=failed_objects_count,
            ),
            events=[],
            unresolved_norad_ids=unresolved_list,
            disclaimer=CONJUNCTION_DISCLAIMER,
        )

    # 3. Perform pairwise conjunction screening across all unique pairs (i < j)
    events: list[ConjunctionEvent] = []
    category_counts = {"CRITICAL": 0, "HIGH": 0, "MODERATE": 0, "LOW": 0}

    for i in range(num_valid):
        obj1 = valid_sat_data[i]
        id1 = obj1["object_id"]
        name1 = obj1["object_name"]
        key1 = obj1["identity_key"]
        map1 = obj1["epoch_map"]
        sat1 = obj1["satrec"]
        raw1 = obj1["original_item"]

        for j in range(i + 1, num_valid):
            obj2 = valid_sat_data[j]
            id2 = obj2["object_id"]
            name2 = obj2["object_name"]
            key2 = obj2["identity_key"]
            map2 = obj2["epoch_map"]
            sat2 = obj2["satrec"]
            raw2 = obj2["original_item"]

            # Defensive guard: Never compare an object with itself or duplicate identity
            if i == j:
                continue
            if id1 == id2 or (key1[0] not in ("MEMORY", "RECORD") and key1 == key2):
                logger.warning("Defensive guard skipped identical object pair: %s and %s", id1, id2)
                continue

            common_epochs = sorted(set(map1.keys()) & set(map2.keys()))
            if not common_epochs:
                continue

            pos1_arr: list[tuple[float, float, float]] = []
            vel1_arr: list[tuple[float, float, float]] = []
            pos2_arr: list[tuple[float, float, float]] = []
            vel2_arr: list[tuple[float, float, float]] = []
            distances: list[float] = []

            for ep in common_epochs:
                p1, v1 = map1[ep]
                p2, v2 = map2[ep]
                pos1_arr.append(p1)
                vel1_arr.append(v1)
                pos2_arr.append(p2)
                vel2_arr.append(v2)
                dx = p2[0] - p1[0]
                dy = p2[1] - p1[1]
                dz = p2[2] - p1[2]
                distances.append(math.sqrt(dx * dx + dy * dy + dz * dz))

            # Derive conservative pair-specific relative speed bound
            v_rel_bound = _estimate_pair_max_relative_speed(raw1, raw2, vel1_arr, vel2_arr)

            # Identify discrete local minima below threshold_km or within full/half-step cutoffs
            candidate_indices = _find_candidate_minima_indices(
                distances,
                threshold_km,
                step_seconds=step_seconds,
                max_relative_speed_kms=v_rel_bound,
            )
            if not candidate_indices:
                continue

            pair_candidates: list[_RefinedEventCandidate] = []

            for idx in candidate_indices:
                if idx == 0:
                    t_a = common_epochs[0]
                    t_b = common_epochs[1] if len(common_epochs) > 1 else t_a
                    i_a, i_b = 0, (1 if len(common_epochs) > 1 else 0)
                    t_m = None
                    i_m = None
                elif idx == len(common_epochs) - 1:
                    t_a = common_epochs[-2]
                    t_b = common_epochs[-1]
                    i_a, i_b = len(common_epochs) - 2, len(common_epochs) - 1
                    t_m = None
                    i_m = None
                else:
                    t_a = common_epochs[idx - 1]
                    t_m = common_epochs[idx]
                    t_b = common_epochs[idx + 1]
                    i_a, i_m, i_b = idx - 1, idx, idx + 1

                if refine_tca:
                    tca, r_rel, v_rel, miss_d, rel_speed, method = _refine_tca_in_bracket(
                        sat1=sat1,
                        sat2=sat2,
                        pos1_a=np.array(pos1_arr[i_a]),
                        vel1_a=np.array(vel1_arr[i_a]),
                        pos1_b=np.array(pos1_arr[i_b]),
                        vel1_b=np.array(vel1_arr[i_b]),
                        pos2_a=np.array(pos2_arr[i_a]),
                        vel2_a=np.array(vel2_arr[i_a]),
                        pos2_b=np.array(pos2_arr[i_b]),
                        vel2_b=np.array(vel2_arr[i_b]),
                        t_a=t_a,
                        t_b=t_b,
                        target_frame=frame_str,
                        pos1_m=np.array(pos1_arr[i_m]) if i_m is not None else None,
                        vel1_m=np.array(vel1_arr[i_m]) if i_m is not None else None,
                        pos2_m=np.array(pos2_arr[i_m]) if i_m is not None else None,
                        vel2_m=np.array(vel2_arr[i_m]) if i_m is not None else None,
                        t_m=t_m,
                    )
                else:
                    tca = common_epochs[idx]
                    r_rel, v_rel, miss_d, rel_speed = compute_relative_state(
                        pos1_arr[idx], vel1_arr[idx], pos2_arr[idx], vel2_arr[idx]
                    )
                    method = "DISCRETE_GRID_MINIMUM"

                if miss_d <= threshold_km:
                    cat = classify_miss_distance(
                        miss_d,
                        threshold_critical_km=threshold_critical_km,
                        threshold_high_km=threshold_high_km,
                        threshold_moderate_km=threshold_moderate_km,
                    )
                    iso_tca = tca.strftime("%Y%m%dT%H%M%SZ")
                    event_id = f"CONJ-{id1}-{id2}-{iso_tca}"

                    ev = ConjunctionEvent(
                        event_id=event_id,
                        object_1_id=id1,
                        object_1_name=name1,
                        object_2_id=id2,
                        object_2_name=name2,
                        tca=tca,
                        miss_distance_km=round(miss_d, 6),
                        relative_position_km=(
                            round(r_rel[0], 6),
                            round(r_rel[1], 6),
                            round(r_rel[2], 6),
                        ),
                        relative_velocity_kms=(
                            round(v_rel[0], 6),
                            round(v_rel[1], 6),
                            round(v_rel[2], 6),
                        ),
                        relative_speed_kms=round(rel_speed, 6),
                        category=cat,
                        screening_threshold_km=threshold_km,
                        frame=frame_str,  # type: ignore[arg-type]
                        step_seconds=step_seconds,
                        method=method,
                        disclaimer=CONJUNCTION_DISCLAIMER,
                    )
                    pair_candidates.append(
                        _RefinedEventCandidate(
                            event=ev,
                            bracket_start=t_a,
                            bracket_end=t_b,
                            candidate_idx=idx,
                        )
                    )

            # Bracket-aware deduplication of duplicate refinements
            if pair_candidates:
                deduped_candidates: list[_RefinedEventCandidate] = []
                # Convergence tolerance for duplicate solutions of the same stationary point
                convergence_tolerance_seconds = max(1.0, min(5.0, 0.05 * step_seconds))

                pair_candidates.sort(key=lambda c: c.event.tca)

                for cand in pair_candidates:
                    if not deduped_candidates:
                        deduped_candidates.append(cand)
                    else:
                        prev_cand = deduped_candidates[-1]
                        ev_prev = prev_cand.event
                        ev_curr = cand.event

                        t1 = ev_prev.tca
                        t2 = ev_curr.tca
                        dt_diff = abs((t2 - t1).total_seconds())

                        # 1. Bracket overlap test
                        overlap_start = max(prev_cand.bracket_start, cand.bracket_start)
                        overlap_end = min(prev_cand.bracket_end, cand.bracket_end)
                        brackets_overlap = overlap_start < overlap_end

                        # 2. Check if both refined TCAs fall within the overlapping search region
                        # (allowing a 1-second numerical margin for boundary convergence)
                        margin = timedelta(seconds=1.0)
                        tcas_in_overlap = (
                            brackets_overlap
                            and (overlap_start - margin <= t1 <= overlap_end + margin)
                            and (overlap_start - margin <= t2 <= overlap_end + margin)
                        )

                        is_same_minimum = False

                        # 3. Only candidate refinements from overlapping brackets within
                        # convergence tolerance can potentially represent the same stationary point
                        if (
                            brackets_overlap
                            and tcas_in_overlap
                            and dt_diff <= convergence_tolerance_seconds
                        ):
                            # 4. Evaluate the continuous relative-distance curve between t1 and t2
                            has_intervening_max = _check_intervening_maximum(
                                t1=t1,
                                t2=t2,
                                d1=ev_prev.miss_distance_km,
                                d2=ev_curr.miss_distance_km,
                                sat1=sat1,
                                sat2=sat2,
                                common_epochs=common_epochs,
                                pos1_arr=pos1_arr,
                                vel1_arr=vel1_arr,
                                pos2_arr=pos2_arr,
                                vel2_arr=vel2_arr,
                                threshold_km=threshold_km,
                            )

                            if not has_intervening_max:
                                # Conclusively demonstrated to be the same local minimum
                                is_same_minimum = True

                        if is_same_minimum:
                            # Keep the refinement with the smaller miss distance
                            if ev_curr.miss_distance_km < ev_prev.miss_distance_km:
                                deduped_candidates[-1] = cand
                        else:
                            # Separate physical encounters or ambiguous candidate identity:
                            # Safe design: preserve both events
                            deduped_candidates.append(cand)

                for cand in deduped_candidates:
                    ev = cand.event
                    category_counts[ev.category] += 1
                    events.append(ev)

    # Sort all conjunction events chronologically by TCA, then miss distance ascending
    events.sort(key=lambda e: (e.tca, e.miss_distance_km))

    execution_duration = time.perf_counter() - t_start_wall

    summary = ConjunctionScreeningSummary(
        total_objects=total_objects_in,
        resolved_objects_count=num_valid,
        unresolved_norad_ids=unresolved_list,
        total_pairs_considered=total_pairs,
        total_events=len(events),
        critical_count=category_counts["CRITICAL"],
        high_count=category_counts["HIGH"],
        moderate_count=category_counts["MODERATE"],
        low_count=category_counts["LOW"],
        start_time=start_dt,
        end_time=end_dt,
        step_seconds=step_seconds,
        threshold_km=threshold_km,
        target_frame=frame_str,  # type: ignore[arg-type]
        processed_at=datetime.now(timezone.utc),
        execution_time_seconds=round(execution_duration, 4),
        failed_objects_count=failed_objects_count,
    )

    return ConjunctionScreeningResponse(
        summary=summary,
        events=events,
        unresolved_norad_ids=unresolved_list,
        disclaimer=CONJUNCTION_DISCLAIMER,
    )
