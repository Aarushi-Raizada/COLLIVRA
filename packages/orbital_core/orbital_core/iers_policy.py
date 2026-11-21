"""
IERS Policy and Earth Orientation Quality Assessment for ZORBIT.

Provides centralized evaluation of Earth orientation parameter (EOP) quality,
provenance tier classification, prediction horizon calculation, and policy enforcement
(OFFLINE_PREDICTIVE vs. OFFLINE_STRICT).

Decouples ZORBIT domain policies from Astropy's internal wall-clock heuristics by
enforcing:
    iers.conf.auto_download = False
    iers.conf.auto_max_age = None
across all operational modes.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from astropy.time import Time
from astropy.utils import iers

from orbital_core.exceptions import EarthOrientationPolicyError
from orbital_core.schemas import EarthOrientationQuality

logger = logging.getLogger("orbital_core.iers_policy")

# Scientific Constants
# Last definitive observation in bundled finals2000A.all is index 19637 (MJD 61321.0, 2026-10-08 00:00:00 UTC)
LAST_DEFINITIVE_MJD: float = 61321.0
DEFAULT_STALE_THRESHOLD_DAYS: float = 30.0

EARTH_ORIENTATION_DISCLAIMER: str = (
    "Earth orientation parameters (UT1-UTC, polar motion) for coordinate transformations "
    "derived from IERS Bulletin A/B. Degraded flags indicate predictive extrapolation "
    "beyond 30 days or boundary fallback."
)


def configure_iers(mode: str | None = None) -> None:
    """
    Configure Astropy IERS settings for ZORBIT.

    Ensures Astropy never makes unexpected network calls or crashes on host clock age
    by enforcing:
        iers.conf.auto_download = False
        iers.conf.auto_max_age = None
    across all operational modes.
    """
    iers.conf.auto_download = False
    iers.conf.auto_max_age = None


def get_iers_mode() -> str:
    """Return the active ZORBIT IERS operational mode ('OFFLINE_PREDICTIVE' or 'OFFLINE_STRICT')."""
    return os.environ.get("ZORBIT_IERS_MODE", "OFFLINE_PREDICTIVE").strip().upper()


def get_stale_threshold_days() -> float:
    """Return the configured threshold in days beyond which predictive EOP is treated as stale."""
    val_str = os.environ.get("ZORBIT_IERS_STALE_THRESHOLD_DAYS", str(DEFAULT_STALE_THRESHOLD_DAYS))
    try:
        return float(val_str)
    except ValueError:
        logger.warning(
            "Invalid ZORBIT_IERS_STALE_THRESHOLD_DAYS '%s'; falling back to %.1f days.",
            val_str,
            DEFAULT_STALE_THRESHOLD_DAYS,
        )
        return DEFAULT_STALE_THRESHOLD_DAYS


def classify_status(
    status: int,
    horizon_days: float,
    threshold_days: float | None = None,
) -> tuple[int, str]:
    """
    Classify a raw Astropy IERS status code into an ordinal rank (0 to 5) and data source name.

    Rank hierarchy:
    - 5: DEFINITIVE (Status 0, FROM_IERS_B)
    - 4: RAPID (Status 1, FROM_IERS_A, or Status 2 with horizon <= 0)
    - 3: PREDICTIVE_FRESH (Status 2, FROM_IERS_A_PREDICTION, with horizon <= threshold)
    - 2: PREDICTIVE_STALE (Status 2, FROM_IERS_A_PREDICTION, with horizon > threshold)
    - 1: BOUNDARY / HISTORICAL FALLBACK (Status -1 or -2)
    - 0: UNAVAILABLE

    Args:
        status: Integer status code from Astropy IERS interpolation.
        horizon_days: Days elapsed since last definitive observation (MJD 61321.0).
        threshold_days: Staleness threshold in days (defaults to configured threshold).

    Returns:
        tuple[int, str]: (rank, data_source_label)
    """
    if threshold_days is None:
        threshold_days = get_stale_threshold_days()

    if status == 0:
        return 5, "DEFINITIVE"
    elif status == 1:
        return 4, "RAPID"
    elif status == 2:
        if horizon_days <= 0.0:
            # Observational ground truth row 19637 (MJD 61321.0)
            return 4, "RAPID"
        elif horizon_days <= threshold_days:
            return 3, "PREDICTIVE_FRESH"
        else:
            return 2, "PREDICTIVE_STALE"
    elif status == -1:
        return 1, "HISTORICAL_FALLBACK"
    elif status == -2:
        return 1, "OUT_OF_RANGE"
    else:
        return 0, "UNAVAILABLE"


def evaluate_earth_orientation_quality(
    status_ut1: int,
    status_pm: int,
    horizon_days: float = 0.0,
    threshold_days: float | None = None,
) -> EarthOrientationQuality:
    """
    Synthesize EarthOrientationQuality from UT1 and Polar Motion statuses using weakest-link logic.

    Args:
        status_ut1: Raw or normalized Astropy status code for UT1-UTC.
        status_pm: Raw or normalized Astropy status code for polar motion.
        horizon_days: Prediction horizon in days relative to MJD 61321.0.
        threshold_days: Staleness threshold in days.

    Returns:
        EarthOrientationQuality record.
    """
    rank_ut1, ds_ut1 = classify_status(status_ut1, horizon_days, threshold_days)
    rank_pm, ds_pm = classify_status(status_pm, horizon_days, threshold_days)

    min_rank = min(rank_ut1, rank_pm)
    is_degraded = min_rank <= 2

    # Determine conservative data_source (weakest link)
    if rank_ut1 <= rank_pm:
        data_source = ds_ut1
    else:
        data_source = ds_pm

    # Determine qualitative provenance tier
    if min_rank in (4, 5):
        provenance_tier = "OBSERVED_EOP"
    elif min_rank == 3:
        provenance_tier = "FORWARD_PREDICTION"
    elif min_rank == 2:
        provenance_tier = "UNMAINTAINED_PREDICTION"
    elif min_rank == 1:
        if status_ut1 == -1 or status_pm == -1:
            provenance_tier = "HISTORICAL_FALLBACK"
        else:
            provenance_tier = "BOUNDARY_FALLBACK"
    else:
        provenance_tier = "UNCALIBRATED_FALLBACK"

    return EarthOrientationQuality(
        data_source=data_source,  # type: ignore[arg-type]
        is_degraded=is_degraded,
        provenance_tier=provenance_tier,  # type: ignore[arg-type]
        prediction_horizon_days=horizon_days,
        table_publication_age_days=None,
        local_cache_age_days=None,
        ut1_status=status_ut1,
        pm_status=status_pm,
        earth_orientation_disclaimer=EARTH_ORIENTATION_DISCLAIMER,
    )


def get_earth_orientation_quality(epoch: datetime | Time) -> EarthOrientationQuality:
    """
    Evaluate the Earth orientation parameters quality for a given epoch.

    Queries the active Astropy IERS table for UT1-UTC and polar motion statuses,
    calculates the prediction horizon relative to the last definitive observation
    (MJD 61321.0 / 2026-10-08 00:00:00 UTC), and aggregates quality according to
    conservative weakest-link rules.

    Args:
        epoch: Datetime or Astropy Time instance representing the requested epoch.

    Returns:
        EarthOrientationQuality model containing quality indicators and metadata.
    """
    configure_iers()
    if isinstance(epoch, datetime):
        t = Time(epoch, scale="utc")
    elif isinstance(epoch, Time):
        t = epoch
    else:
        t = Time(epoch)

    table = iers.earth_orientation_table.get()

    _, raw_status_ut1 = table.ut1_utc(t, return_status=True)
    _, _, raw_status_pm = table.pm_xy(t, return_status=True)

    status_ut1 = int(raw_status_ut1)
    status_pm = int(raw_status_pm)

    mjd_requested = float(t.mjd)
    if mjd_requested > LAST_DEFINITIVE_MJD:
        horizon_days = mjd_requested - LAST_DEFINITIVE_MJD
    else:
        horizon_days = 0.0

    # Handle Astropy searchsorted(side='right') index alignment:
    # Row 19637 (MJD 61321.0) is the last definitive observation ('I' / FROM_IERS_A).
    # When mjd <= 61321.0, data is observational ground truth.
    if mjd_requested <= LAST_DEFINITIVE_MJD and status_ut1 == 2:
        status_ut1 = 1
    if mjd_requested <= LAST_DEFINITIVE_MJD and status_pm == 2:
        status_pm = 1

    return evaluate_earth_orientation_quality(
        status_ut1=status_ut1,
        status_pm=status_pm,
        horizon_days=horizon_days,
    )


def check_earth_orientation_policy(
    epoch: datetime | Time,
    mode: str | None = None,
) -> EarthOrientationQuality:
    """
    Check Earth orientation quality against the active or specified operational policy mode.

    Modes:
    - 'OFFLINE_PREDICTIVE' (default): Permits calculation, records degraded metadata
      if epoch exceeds calibration horizon (>30d) or table coverage.
    - 'OFFLINE_STRICT': Rejects degraded orientation by raising EarthOrientationPolicyError.

    Args:
        epoch: Target epoch to validate.
        mode: Operational mode string override. If None, reads ZORBIT_IERS_MODE env var.

    Returns:
        EarthOrientationQuality: Validated quality metadata.

    Raises:
        EarthOrientationPolicyError: If mode is 'OFFLINE_STRICT' and quality is degraded.
    """
    active_mode = (mode or get_iers_mode()).strip().upper()
    quality = get_earth_orientation_quality(epoch)

    if active_mode == "OFFLINE_STRICT" and quality.is_degraded:
        epoch_dt: datetime | None = None
        if isinstance(epoch, datetime):
            epoch_dt = epoch
        elif isinstance(epoch, Time):
            epoch_dt = epoch.to_datetime(timezone.utc)

        msg = (
            f"Earth orientation parameters rejected under OFFLINE_STRICT policy: "
            f"epoch {epoch} has degraded quality ({quality.data_source}, "
            f"provenance={quality.provenance_tier}, horizon={quality.prediction_horizon_days:.1f}d)."
        )
        raise EarthOrientationPolicyError(
            message=msg,
            epoch=epoch_dt,
            data_source=quality.data_source,
            details={
                "provenance_tier": quality.provenance_tier,
                "prediction_horizon_days": quality.prediction_horizon_days,
                "ut1_status": quality.ut1_status,
                "pm_status": quality.pm_status,
                "mode": active_mode,
            },
        )

    return quality