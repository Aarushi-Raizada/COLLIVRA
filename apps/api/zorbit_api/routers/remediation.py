"""
Remediation and Simulation Router for COLLIVRA API.

Exposes REST endpoints for synthetic breakup propagation and Clohessy-Wiltshire (CW)
rendezvous remediation planning.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from simulation import (
    BreakupAndPropagateRequest,
    BreakupAndPropagateResponse,
    BreakupRemediationRequest,
    BreakupRemediationResponse,
    plan_breakup_remediation,
    simulate_breakup_and_propagate,
)

logger = logging.getLogger("zorbit_api.remediation")

router = APIRouter(
    tags=["Simulation & Remediation"],
)


@router.post(
    "/api/v1/simulation/breakup-and-propagate",
    response_model=BreakupAndPropagateResponse,
    status_code=status.HTTP_200_OK,
    summary="Simulate synthetic collision breakup and numerically propagate fragment trajectories",
    description=(
        "Chains the simplified synthetic fragmentation model with the Cowell/DOP853 J2 numerical "
        "batch propagator in GCRS. Returns generated fragment records, conservation metrics, "
        "and integrated Cartesian ephemerides."
    ),
)
def breakup_and_propagate(
    request: BreakupAndPropagateRequest,
) -> BreakupAndPropagateResponse:
    """Execute synthetic collision breakup and propagate the resulting fragment batch."""
    try:
        frag_result, traj_batch = simulate_breakup_and_propagate(
            scenario=request.scenario,
            propagation_config=request.propagation_config,
        )
        return BreakupAndPropagateResponse(
            fragmentation=frag_result,
            trajectories=traj_batch,
        )
    except ValueError as exc:
        logger.warning("Domain validation failure during breakup and propagation: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected internal error in breakup and propagation: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal simulation failure.",
        ) from exc


@router.post(
    "/api/v1/remediation/breakup-and-rendezvous",
    response_model=BreakupRemediationResponse,
    status_code=status.HTTP_200_OK,
    summary="Simulate breakup and compute CW rendezvous targeting for highest-mass fragment",
    description=(
        "Sequentially simulates collision breakup, propagates fragments via DOP853 J2 numerical "
        "integration, deterministically targets the highest-mass CW-compliant fragment surviving "
        "the full transfer window, and computes a two-impulse Clohessy-Wiltshire rendezvous burn solution."
    ),
)
def breakup_and_rendezvous(
    request: BreakupRemediationRequest,
) -> BreakupRemediationResponse:
    """Execute end-to-end breakup simulation, target selection, and CW rendezvous planning."""
    try:
        return plan_breakup_remediation(request)
    except ValueError as exc:
        logger.warning("Domain validation failure during breakup remediation: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected internal error in breakup remediation orchestrator: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal simulation failure.",
        ) from exc

