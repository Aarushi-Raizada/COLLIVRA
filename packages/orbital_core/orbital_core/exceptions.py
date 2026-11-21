"""
Domain exceptions for orbital_core.

Defines the domain-level exception hierarchy for coordinate frame transformations,
Earth orientation parameter policies (IERS), propagation, and screening.
Independent of web frameworks (FastAPI, Starlette).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


class OrbitalCoreError(Exception):
    """Base exception for all orbital_core domain errors."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class EarthOrientationPolicyError(OrbitalCoreError):
    """
    Raised when an orbital calculation violates the active Earth orientation (IERS) policy.

    Attributes:
        message: Human-readable error description.
        epoch: The datetime that violated policy bounds.
        data_source: Provenance/source tier of the rejected parameters (e.g., 'PREDICTIVE_STALE', 'OUT_OF_RANGE').
        details: Additional structured context (e.g., prediction horizon, threshold).
    """

    def __init__(
        self,
        message: str,
        epoch: datetime | None = None,
        data_source: str = "UNKNOWN",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.epoch = epoch
        self.data_source = data_source
        self.details = details or {}

    def __str__(self) -> str:
        epoch_str = self.epoch.isoformat() if self.epoch else "None"
        return f"{self.message} (epoch={epoch_str}, data_source={self.data_source})"

