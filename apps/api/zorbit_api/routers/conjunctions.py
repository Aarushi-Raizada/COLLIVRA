"""
Conjunction Screening Router for COLLIVRA API.

Exposes REST endpoint for multi-satellite close approach screening.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status
from orbital_core.celestrak import CelesTrakClient, CelesTrakError
from orbital_core.conjunction import screen_conjunctions
from orbital_core.exceptions import EarthOrientationPolicyError
from orbital_core.frames import FrameTransformationError
from orbital_core.iers_policy import check_earth_orientation_policy, classify_status
from orbital_core.schemas import (
    ConjunctionScreeningRequest,
    ConjunctionScreeningResponse,
    EarthOrientationQuality,
    OrbitalObjectRecord,
)

logger = logging.getLogger("zorbit_api.conjunctions")

router = APIRouter(
    prefix="/api/v1/conjunctions",
    tags=["Conjunction Screening"],
)


def _get_quality_rank(q: EarthOrientationQuality) -> int:
    """Extract ordinal quality rank (0=unavailable to 5=definitive) from EarthOrientationQuality."""
    horizon = q.prediction_horizon_days if q.prediction_horizon_days is not None else 0.0
    rank_ut1, _ = classify_status(q.ut1_status, horizon)
    rank_pm, _ = classify_status(q.pm_status, horizon)
    return min(rank_ut1, rank_pm)


def _aggregate_interval_quality(
    q_start: EarthOrientationQuality,
    q_end: EarthOrientationQuality,
) -> EarthOrientationQuality:
    """
    Establish weakest Earth orientation parameter quality across a screening interval.

    Because the IERS parameter quality rank function is unimodal (quasi-concave)
    over time (historical fallback -> definitive -> rapid -> fresh prediction ->
    stale prediction -> out of range), the minimum quality over any interval
    [t_start, t_end] is strictly attained at one of the boundaries.

    Ranking priority:
    1. Lower ordinal rank (0 to 5) represents weaker/more degraded quality.
    2. If ranks are equal, larger prediction horizon represents greater extrapolation uncertainty.
    """
    rank_start = _get_quality_rank(q_start)
    rank_end = _get_quality_rank(q_end)

    if rank_end < rank_start:
        return q_end
    elif rank_start < rank_end:
        return q_start
    else:
        h_start = q_start.prediction_horizon_days if q_start.prediction_horizon_days is not None else 0.0
        h_end = q_end.prediction_horizon_days if q_end.prediction_horizon_days is not None else 0.0
        return q_end if h_end >= h_start else q_start


@router.post(
    "/screen",
    response_model=ConjunctionScreeningResponse,
    status_code=status.HTTP_200_OK,
    summary="Screen orbital objects for close approaches",
    description=(
        "Identifies potential conjunction events below a distance threshold "
        "across a configurable time window using analytical SGP4 propagation "
        "and numerical Time of Closest Approach (TCA) refinement."
    ),
)
def screen_orbital_conjunctions(
    request: ConjunctionScreeningRequest,
) -> ConjunctionScreeningResponse:
    """
    Execute conjunction screening between submitted orbital objects or catalog IDs.
    """
    satellites: list[OrbitalObjectRecord | dict[str, Any]] = list(request.objects)
    unresolved_norad_ids: list[int] = []

    # If norad_ids provided, resolve them via CelesTrak client (with offline cache fallback)
    if request.norad_ids:
        client = CelesTrakClient()
        for norad_id in request.norad_ids:
            try:
                rec = client.get_by_norad_id(norad_id)
                if rec is not None:
                    satellites.append(rec)
                else:
                    try:
                        unresolved_norad_ids.append(int(norad_id))
                    except (ValueError, TypeError):
                        pass
            except CelesTrakError as err:
                logger.warning("Failed to resolve NORAD ID %s: %s", norad_id, err)
                try:
                    unresolved_norad_ids.append(int(norad_id))
                except (ValueError, TypeError):
                    pass

    total_requested = len(request.objects) + len(request.norad_ids or [])

    try:
        quality = None
        frame_str = str(request.target_frame).strip().upper()
        if frame_str != "TEME":
            # Validate complete screening interval before executing propagation
            q_start = check_earth_orientation_policy(request.start_time)
            q_end = check_earth_orientation_policy(request.end_time)
            quality = _aggregate_interval_quality(q_start, q_end)

        response = screen_conjunctions(
            satellites=satellites,
            start_time=request.start_time,
            end_time=request.end_time,
            step_seconds=request.step_seconds,
            threshold_km=request.threshold_km,
            target_frame=request.target_frame,
            threshold_critical_km=request.threshold_critical_km,
            threshold_high_km=request.threshold_high_km,
            threshold_moderate_km=request.threshold_moderate_km,
            unresolved_norad_ids=unresolved_norad_ids,
            total_requested_objects=total_requested,
        )
        if quality is not None:
            response.summary.earth_orientation = quality
            response.earth_orientation = quality
        return response
    except EarthOrientationPolicyError:
        raise
    except ValueError as val_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        ) from val_err
    except FrameTransformationError as frame_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(frame_err),
        ) from frame_err
    except Exception as exc:
        logger.exception("Conjunction screening unexpected error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Conjunction screening calculation failed: {exc}",
        ) from exc
