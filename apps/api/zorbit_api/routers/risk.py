"""
Risk Prioritization Router for COLLIVRA API.

Exposes REST endpoints for explainable heuristic risk scoring of screened conjunction events.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from orbital_core.risk import assess_risk, assess_risk_batch
from orbital_core.schemas import (
    RiskAssessment,
    RiskAssessmentBatchRequest,
    RiskAssessmentBatchResponse,
    RiskAssessmentRequest,
)

logger = logging.getLogger("zorbit_api.risk")

router = APIRouter(
    prefix="/api/v1/risk",
    tags=["Risk Prioritization Engine"],
)


@router.post(
    "/assess",
    response_model=RiskAssessment,
    status_code=status.HTTP_200_OK,
    summary="Assess heuristic risk for a single conjunction event",
    description=(
        "Calculates an explainable heuristic risk score [0.0 - 100.0] and dimensional factor "
        "breakdown for a screened conjunction event. This score is an uncalibrated engineering "
        "triage index for decision support and does NOT represent formal collision "
        "probability (Pc)."
    ),
)
def assess_single_conjunction(request: RiskAssessmentRequest) -> RiskAssessment:
    """Assess heuristic risk for a single conjunction event."""
    try:
        return assess_risk(
            event=request.event,
            evaluation_time=request.evaluation_time,
            custom_weights=request.custom_weights,
        )
    except ValueError as exc:
        logger.warning("Validation error in single risk assessment: %s", exc)
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc


@router.post(
    "/assess-batch",
    response_model=RiskAssessmentBatchResponse,
    status_code=status.HTTP_200_OK,
    summary="Assess heuristic risk for a batch of conjunction events",
    description=(
        "Batch processes multiple screened conjunction events under a unified evaluation "
        "epoch, returning deterministically ordered risk assessments (highest risk first) "
        "with operational category summary counts. Empty batches return zeroed summary counts."
    ),
)
def assess_batch_conjunctions(
    request: RiskAssessmentBatchRequest,
) -> RiskAssessmentBatchResponse:
    """Assess heuristic risk for a batch of conjunction events."""
    try:
        return assess_risk_batch(
            events=request.events,
            evaluation_time=request.evaluation_time,
            custom_weights=request.custom_weights,
        )
    except ValueError as exc:
        logger.warning("Validation error in batch risk assessment: %s", exc)
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
