"""
Backward-compatibility alias module for Clohessy-Wiltshire relative motion and rendezvous.

Re-exports all public symbols from simulation.rendezvous and simulation.schemas.
"""

from __future__ import annotations

from simulation.rendezvous import (
    ATMOSPHERIC_BOUNDARY_KM,
    DEFAULT_MAX_CONDITION_NUMBER,
    DEFAULT_POSITION_TOLERANCE_KM,
    DEFAULT_VELOCITY_TOLERANCE_KMS,
    EARTH_EQUATORIAL_RADIUS_KM,
    ECCENTRICITY_THRESHOLD,
    MIN_PERIGEE_RADIUS_KM,
    MU_EARTH_KM3_S2,
    SCIENTIFIC_DISCLAIMER,
    compute_cw_stm,
    cw_to_gcrs,
    gcrs_to_cw,
    gcrs_to_hill,
    hill_to_gcrs,
    plan_debris_rendezvous,
    solve_two_impulse_cw,
)
from simulation.schemas import (
    RendezvousConfig,
    RendezvousContract,
    RendezvousResult,
    TargetingMode,
)

__all__ = [
    "MU_EARTH_KM3_S2",
    "EARTH_EQUATORIAL_RADIUS_KM",
    "MIN_PERIGEE_RADIUS_KM",
    "ATMOSPHERIC_BOUNDARY_KM",
    "ECCENTRICITY_THRESHOLD",
    "DEFAULT_MAX_CONDITION_NUMBER",
    "DEFAULT_POSITION_TOLERANCE_KM",
    "DEFAULT_VELOCITY_TOLERANCE_KMS",
    "SCIENTIFIC_DISCLAIMER",
    "compute_cw_stm",
    "solve_two_impulse_cw",
    "gcrs_to_hill",
    "hill_to_gcrs",
    "gcrs_to_cw",
    "cw_to_gcrs",
    "plan_debris_rendezvous",
    "TargetingMode",
    "RendezvousConfig",
    "RendezvousContract",
    "RendezvousResult",
]
