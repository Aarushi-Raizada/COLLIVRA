"""
Day 7 Heuristic Risk-Prioritization Engine for ZORBIT.

Implements an explainable, deterministic heuristic triage index for close-approach
conjunction events identified during orbital screening.

Scientific Integrity Guardrails (AGENTS.md Section 3.2):
- This engine computes an uncalibrated engineering triage index in [0.0 - 100.0].
- It does NOT calculate or represent formal probability of collision (Pc).
- Public TLE/OMM ephemerides lack position covariance matrices required for Pc.
- The three scoring dimensions (miss distance, encounter relative speed, time-to-TCA)
  are distinct engineered evaluation factors, not physically or statistically independent.
- Scaling constants (2.0 km, 15.0 km/s, 36.0 h) and weights (0.50, 0.25, 0.25)
  are configurable prototype defaults.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from orbital_core.schemas import (
    ConjunctionEvent,
    DataQualityLevel,
    RiskAssessment,
    RiskAssessmentBatchResponse,
    RiskCategory,
    RiskFactor,
    RiskWeights,
    normalize_datetime_utc,
)

# Prototype Default Constants (Configurable defaults, not universal physical limits)
DEFAULT_DISTANCE_SCALE_KM: float = 2.0
DEFAULT_SPEED_SCALE_KMS: float = 15.0
DEFAULT_TIME_HALFLIFE_HOURS: float = 36.0

DEFAULT_WEIGHT_DISTANCE: float = 0.50
DEFAULT_WEIGHT_SPEED: float = 0.25
DEFAULT_WEIGHT_TIME: float = 0.25

RISK_DISCLAIMER: str = (
    "Scientific Disclaimer: Heuristic risk scores [0.0 - 100.0] are empirical "
    "triage approximations for decision-support and do NOT represent formal "
    "probability of collision (Pc). Public TLE/OMM elements do not provide "
    "calibrated covariance matrices necessary for formal Pc computation."
)


def get_risk_category(score: float) -> RiskCategory:
    """
    Map composite heuristic risk score [0.0 - 100.0] into five operational triage tiers.

    - CRITICAL: 75.0 <= score <= 100.0
    - HIGH: 50.0 <= score < 75.0
    - MODERATE: 25.0 <= score < 50.0
    - LOW: 10.0 <= score < 25.0
    - NEGLIGIBLE: 0.0 <= score < 10.0
    """
    if score >= 75.0:
        return RiskCategory.CRITICAL
    elif score >= 50.0:
        return RiskCategory.HIGH
    elif score >= 25.0:
        return RiskCategory.MODERATE
    elif score >= 10.0:
        return RiskCategory.LOW
    else:
        return RiskCategory.NEGLIGIBLE


def calculate_risk_factors(
    event: ConjunctionEvent,
    evaluation_time: datetime,
    weights: RiskWeights | None = None,
) -> tuple[list[RiskFactor], list[str]]:
    """
    Compute dimensional risk factors and any physical warnings for a screened conjunction event.

    Formulas:
    - Miss Distance: f_distance = exp(-miss_distance_km / 2.0)
    - Relative Speed: f_speed = min(relative_speed_kms / 15.0, 1.0)
    - Time-to-TCA:
        delta_t_hours = (tca - evaluation_time).total_seconds() / 3600.0
        f_time = 2 ** (-delta_t_hours / 36.0) if delta_t_hours >= 0.0 else 0.0

    At exact TCA (delta_t_hours = 0.0), f_time = 1.0.
    For strictly historical encounters (delta_t_hours < 0.0), f_time = 0.0 and an explanatory
    warning is recorded.

    Returns:
        tuple[list[RiskFactor], list[str]]: (factors, warnings)
    """
    if weights is None:
        weights = RiskWeights()

    # Ensure evaluation_time and event.tca are UTC
    eval_utc = normalize_datetime_utc(evaluation_time, field_name="evaluation_time")
    tca_utc = normalize_datetime_utc(event.tca, field_name="ConjunctionEvent TCA")

    # Validate kinematics
    if not math.isfinite(event.miss_distance_km) or event.miss_distance_km < 0.0:
        raise ValueError(
            f"Invalid miss_distance_km: {event.miss_distance_km}. Must be finite and >= 0.0."
        )
    if not math.isfinite(event.relative_speed_kms) or event.relative_speed_kms < 0.0:
        raise ValueError(
            f"Invalid relative_speed_kms: {event.relative_speed_kms}. Must be finite and >= 0.0."
        )

    warnings: list[str] = []

    # 1. Miss Distance Factor
    d_km = event.miss_distance_km
    f_distance = math.exp(-d_km / DEFAULT_DISTANCE_SCALE_KM)
    w_distance = weights.weight_distance
    contrib_distance = 100.0 * w_distance * f_distance
    factor_distance = RiskFactor(
        factor_name="MISS_DISTANCE",
        raw_value=d_km,
        raw_units="km",
        normalized_value=f_distance,
        weight=w_distance,
        contribution=contrib_distance,
        description=(
            f"Exponential decay with scale {DEFAULT_DISTANCE_SCALE_KM} km: "
            f"exp(-{d_km:.4f} / {DEFAULT_DISTANCE_SCALE_KM})"
        ),
    )

    # 2. Encounter Relative Speed Factor
    v_kms = event.relative_speed_kms
    f_speed = min(v_kms / DEFAULT_SPEED_SCALE_KMS, 1.0)
    w_speed = weights.weight_speed
    contrib_speed = 100.0 * w_speed * f_speed
    if v_kms == 0.0:
        warnings.append(
            "Encounter relative speed is zero (co-orbital or formation geometry); "
            "speed factor evaluated to 0.0."
        )
    factor_speed = RiskFactor(
        factor_name="RELATIVE_SPEED",
        raw_value=v_kms,
        raw_units="km/s",
        normalized_value=f_speed,
        weight=w_speed,
        contribution=contrib_speed,
        description=(
            f"Linear ramp clamped at {DEFAULT_SPEED_SCALE_KMS} km/s: "
            f"min({v_kms:.4f} / {DEFAULT_SPEED_SCALE_KMS}, 1.0)"
        ),
    )

    # 3. Time-to-TCA Factor
    delta_t_seconds = (tca_utc - eval_utc).total_seconds()
    delta_t_hours = delta_t_seconds / 3600.0
    if delta_t_hours >= 0.0:
        f_time = 2.0 ** (-delta_t_hours / DEFAULT_TIME_HALFLIFE_HOURS)
    else:
        f_time = 0.0
        warnings.append(
            "TCA occurred before the evaluation epoch (historical encounter); "
            "time factor evaluated to 0.0."
        )
    w_time = weights.weight_time
    contrib_time = 100.0 * w_time * f_time
    factor_time = RiskFactor(
        factor_name="TIME_TO_TCA",
        raw_value=delta_t_hours,
        raw_units="hours",
        normalized_value=f_time,
        weight=w_time,
        contribution=contrib_time,
        description=(
            f"Exponential decay with {DEFAULT_TIME_HALFLIFE_HOURS} h half-life: "
            f"2^(-{delta_t_hours:.4f} / {DEFAULT_TIME_HALFLIFE_HOURS}) if >= 0 else 0.0"
        ),
    )

    return [factor_distance, factor_speed, factor_time], warnings


def assess_risk(
    event: ConjunctionEvent,
    evaluation_time: datetime | None = None,
    custom_weights: RiskWeights | None = None,
) -> RiskAssessment:
    """
    Assess heuristic risk for a single screened conjunction event.

    Args:
        event: Screened ConjunctionEvent instance.
        evaluation_time: Authoritative evaluation epoch. Defaults to current UTC.
        custom_weights: Optional custom dimensional weights summing to 1.0.

    Returns:
        RiskAssessment containing score [0.0 - 100.0], category, factor breakdown,
        and scientific disclaimer.
    """
    eval_utc = (
        normalize_datetime_utc(evaluation_time, field_name="evaluation_time")
        if evaluation_time is not None
        else datetime.now(timezone.utc)
    )
    weights = custom_weights if custom_weights is not None else RiskWeights()

    factors, warnings = calculate_risk_factors(event, eval_utc, weights)
    total_score = sum(f.contribution for f in factors)
    clamped_score = max(0.0, min(100.0, total_score))
    category = get_risk_category(clamped_score)

    return RiskAssessment(
        event_id=event.event_id,
        primary_object_id=event.object_1_id,
        primary_object_name=event.object_1_name,
        secondary_object_id=event.object_2_id,
        secondary_object_name=event.object_2_name,
        tca=event.tca.astimezone(timezone.utc),
        miss_distance_km=event.miss_distance_km,
        relative_speed_kms=event.relative_speed_kms,
        risk_score=clamped_score,
        risk_category=category,
        evaluation_time=eval_utc,
        factors=factors,
        data_quality=DataQualityLevel.COMPLETE,
        warnings=warnings,
        scientific_disclaimer=RISK_DISCLAIMER,
    )


def assess_risk_batch(
    events: list[ConjunctionEvent],
    evaluation_time: datetime | None = None,
    custom_weights: RiskWeights | None = None,
) -> RiskAssessmentBatchResponse:
    """
    Assess heuristic risk for a batch of screened conjunction events.

    Invariants:
    - Authoritative evaluation time sampled once if omitted.
    - Duplicate event_id rejected with ValueError.
    - Deterministic sorting by (-risk_score, event_id, tca).
    - Empty batch returns HTTP 200 with zeroed counts.
    - Category summary counts tallied across all items.
    """
    eval_utc = (
        normalize_datetime_utc(evaluation_time, field_name="evaluation_time")
        if evaluation_time is not None
        else datetime.now(timezone.utc)
    )
    weights = custom_weights if custom_weights is not None else RiskWeights()

    # Reject duplicate event_ids
    seen: set[str] = set()
    for ev in events:
        if ev.event_id in seen:
            raise ValueError(f"Duplicate event_id '{ev.event_id}' detected in batch request.")
        seen.add(ev.event_id)

    if not events:
        return RiskAssessmentBatchResponse(
            total_assessed=0,
            critical_count=0,
            high_count=0,
            moderate_count=0,
            low_count=0,
            negligible_count=0,
            evaluation_time=eval_utc,
            assessments=[],
        )

    assessments = [
        assess_risk(ev, evaluation_time=eval_utc, custom_weights=weights) for ev in events
    ]

    # Deterministic sorting: descending score, then event_id ascending, then tca ascending
    assessments.sort(key=lambda a: (-a.risk_score, a.event_id, a.tca))

    critical_count = sum(1 for a in assessments if a.risk_category == RiskCategory.CRITICAL)
    high_count = sum(1 for a in assessments if a.risk_category == RiskCategory.HIGH)
    moderate_count = sum(1 for a in assessments if a.risk_category == RiskCategory.MODERATE)
    low_count = sum(1 for a in assessments if a.risk_category == RiskCategory.LOW)
    negligible_count = sum(1 for a in assessments if a.risk_category == RiskCategory.NEGLIGIBLE)

    return RiskAssessmentBatchResponse(
        total_assessed=len(assessments),
        critical_count=critical_count,
        high_count=high_count,
        moderate_count=moderate_count,
        low_count=low_count,
        negligible_count=negligible_count,
        evaluation_time=eval_utc,
        assessments=assessments,
    )
