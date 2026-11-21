/**
 * COLLIVRA Offline Demo Data & Verification Fixtures
 *
 * Deterministic offline data representing realistic Space Situational Awareness (SSA)
 * telemetry derived from benchmark CelesTrak OMM snapshots (ISS & Tiangong).
 *
 * Explicit Provenance:
 * - Data Source: OFFLINE_FIXTURE
 * - Source File: data/fixtures/stations_omm.json
 * - Reference Epoch: 2026-11-02T12:00:00.000Z
 * - Coordinate Frame: GCRS (Geocentric Celestial Reference System, IAU 2000)
 */

import {
  ConjunctionEvent,
  ConjunctionScreeningResponse,
  HealthResponse,
  OrbitalObjectRecord,
  RiskAssessment,
  RiskAssessmentBatchResponse,
} from "./../types/api";
import { DataSourceInfo } from "./../types/orbital";

const CONJUNCTION_DISCLAIMER =
  "Scientific Disclaimer: Conjunction screening results are preliminary geometric " +
  "close-approach screenings derived from analytical SGP4 propagation. They do NOT " +
  "represent formal probability of collision (Pc), which requires calibrated error " +
  "covariance matrices. Public TLE/OMM data does not provide covariance information.";

const HEURISTIC_RISK_DISCLAIMER =
  "Scientific Disclaimer: Heuristic risk scores [0.0 - 100.0] are empirical " +
  "screening approximations for decision-support and do NOT represent formal " +
  "probability of collision (Pc). Public TLE/OMM elements do not provide " +
  "calibrated covariance matrices.";

export const MOCK_DATA_SOURCE_INFO: DataSourceInfo = {
  mode: "OFFLINE_DEMO",
  label: "DEMO FIXTURE",
  provenance: "Benchmark CelesTrak Stations Snapshot (data/fixtures/stations_omm.json)",
  epoch: "2026-11-02T12:00:00.000Z",
  offlineIers: true,
  objectCount: 5,
};

export const MOCK_HEALTH_RESPONSE: HealthResponse = {
  status: "healthy",
  service: "zorbit_api",
  version: "0.1.0",
  offline_mode: true,
};

export const MOCK_SATELLITE_OBJECTS: OrbitalObjectRecord[] = [
  {
    norad_cat_id: "25544",
    object_name: "ISS (ZARYA)",
    object_id: "1998-067A",
    classification_type: "U",
    epoch: "2026-11-01T18:56:25.712736+00:00",
    mean_motion: 15.49143202,
    eccentricity: 0.0007125,
    inclination: 51.6329,
    ra_of_asc_node: 339.4674,
    arg_of_pericenter: 334.8215,
    mean_anomaly: 25.3275,
    bstar: 0.0001045,
    mean_motion_dot: 0.0000531,
    mean_motion_ddot: 0.0,
    semi_major_axis_km: 6797.35,
    period_minutes: 92.95,
    periapsis_altitude_km: 414.38,
    apoapsis_altitude_km: 424.06,
    is_synthetic: false,
    data_source: "OFFLINE_FIXTURE",
    retrieved_at: "2026-11-02T12:00:00.000Z",
  },
  {
    norad_cat_id: "48274",
    object_name: "CSS (TIANHE)",
    object_id: "2021-035A",
    classification_type: "U",
    epoch: "2026-11-02T03:46:01.528896+00:00",
    mean_motion: 15.61293776,
    eccentricity: 0.0004512,
    inclination: 41.4721,
    ra_of_asc_node: 112.5489,
    arg_of_pericenter: 215.3411,
    mean_anomaly: 144.7892,
    bstar: 0.0000892,
    mean_motion_dot: 0.0000412,
    mean_motion_ddot: 0.0,
    semi_major_axis_km: 6762.15,
    period_minutes: 92.23,
    periapsis_altitude_km: 380.96,
    apoapsis_altitude_km: 387.08,
    is_synthetic: false,
    data_source: "OFFLINE_FIXTURE",
    retrieved_at: "2026-11-02T12:00:00.000Z",
  },
];

export const MOCK_CONJUNCTION_EVENTS: ConjunctionEvent[] = [
  {
    event_id: "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z",
    object_1_id: "25544",
    object_1_name: "ISS (ZARYA)",
    object_2_id: "SYNTH-FRAG-0042",
    object_2_name: "Synthetic Debris Fragment #042",
    tca: "2026-11-02T12:18:45.000Z",
    miss_distance_km: 0.842,
    relative_position_km: [0.412, -0.618, 0.389],
    relative_velocity_kms: [-10.412, 6.128, 4.312],
    relative_speed_kms: 12.812,
    category: "CRITICAL",
    screening_threshold_km: 50.0,
    frame: "GCRS",
    step_seconds: 60.0,
    method: "NUMERICAL_OPTIMIZATION",
    disclaimer: CONJUNCTION_DISCLAIMER,
  },
  {
    event_id: "CONJ-25544-SYNTH-FRAG-0006-20261102T122215Z",
    object_1_id: "25544",
    object_1_name: "ISS (ZARYA)",
    object_2_id: "SYNTH-FRAG-0006",
    object_2_name: "Synthetic Debris Fragment #006",
    tca: "2026-11-02T12:22:15.184Z",
    miss_distance_km: 2.145,
    relative_position_km: [1.104, -1.612, 0.884],
    relative_velocity_kms: [-9.812, 3.104, 2.451],
    relative_speed_kms: 10.578,
    category: "HIGH",
    screening_threshold_km: 50.0,
    frame: "GCRS",
    step_seconds: 60.0,
    method: "NUMERICAL_OPTIMIZATION",
    disclaimer: CONJUNCTION_DISCLAIMER,
  },
  {
    event_id: "CONJ-25544-48274-20261102T120530Z",
    object_1_id: "25544",
    object_1_name: "ISS (ZARYA)",
    object_2_id: "48274",
    object_2_name: "CSS (TIANHE)",
    tca: "2026-11-02T12:05:30.412Z",
    miss_distance_km: 8.421,
    relative_position_km: [4.215, -6.128, 3.891],
    relative_velocity_kms: [-7.412, 5.892, 5.124],
    relative_speed_kms: 10.842,
    category: "MODERATE",
    screening_threshold_km: 50.0,
    frame: "GCRS",
    step_seconds: 60.0,
    method: "NUMERICAL_OPTIMIZATION",
    disclaimer: CONJUNCTION_DISCLAIMER,
  },
];

export const MOCK_RISK_ASSESSMENTS: RiskAssessment[] = [
  {
    event_id: "CONJ-25544-SYNTH-FRAG-0042-20261102T121845Z",
    primary_object_id: "25544",
    primary_object_name: "ISS (ZARYA)",
    secondary_object_id: "SYNTH-FRAG-0042",
    secondary_object_name: "Synthetic Debris Fragment #042",
    tca: "2026-11-02T12:18:45.000Z",
    miss_distance_km: 0.842,
    relative_speed_kms: 12.812,
    risk_score: 79.02,
    risk_category: "CRITICAL",
    evaluation_time: "2026-11-02T12:00:00.000Z",
    factors: [
      {
        factor_name: "MISS_DISTANCE",
        raw_value: 0.842,
        raw_units: "km",
        normalized_value: 0.65639,
        weight: 0.50,
        contribution: 32.82,
        description: "Exponential decay with scale 2.0 km: exp(-0.8420 / 2.0)",
      },
      {
        factor_name: "RELATIVE_SPEED",
        raw_value: 12.812,
        raw_units: "km/s",
        normalized_value: 0.85413,
        weight: 0.25,
        contribution: 21.35,
        description: "Linear ramp clamped at 15.0 km/s: min(12.8120 / 15.0, 1.0)",
      },
      {
        factor_name: "TIME_TO_TCA",
        raw_value: 0.3125,
        raw_units: "hours",
        normalized_value: 0.99400,
        weight: 0.25,
        contribution: 24.85,
        description: "Exponential decay with 36.0 h half-life: 2^(-0.3125 / 36.0) if >= 0 else 0.0",
      },
    ],
    data_quality: "COMPLETE",
    warnings: [
      "Secondary object is a synthetic fragment; trajectory derived from Cowell J2 numerical integration.",
    ],
    scientific_disclaimer: HEURISTIC_RISK_DISCLAIMER,
  },
  {
    event_id: "CONJ-25544-SYNTH-FRAG-0006-20261102T122215Z",
    primary_object_id: "25544",
    primary_object_name: "ISS (ZARYA)",
    secondary_object_id: "SYNTH-FRAG-0006",
    secondary_object_name: "Synthetic Debris Fragment #006",
    tca: "2026-11-02T12:22:15.184Z",
    miss_distance_km: 2.145,
    relative_speed_kms: 10.578,
    risk_score: 59.56,
    risk_category: "HIGH",
    evaluation_time: "2026-11-02T12:00:00.000Z",
    factors: [
      {
        factor_name: "MISS_DISTANCE",
        raw_value: 2.145,
        raw_units: "km",
        normalized_value: 0.34215,
        weight: 0.50,
        contribution: 17.11,
        description: "Exponential decay with scale 2.0 km: exp(-2.1450 / 2.0)",
      },
      {
        factor_name: "RELATIVE_SPEED",
        raw_value: 10.578,
        raw_units: "km/s",
        normalized_value: 0.7052,
        weight: 0.25,
        contribution: 17.63,
        description: "Linear ramp clamped at 15.0 km/s: min(10.5780 / 15.0, 1.0)",
      },
      {
        factor_name: "TIME_TO_TCA",
        raw_value: 0.37088,
        raw_units: "hours",
        normalized_value: 0.99288,
        weight: 0.25,
        contribution: 24.82,
        description: "Exponential decay with 36.0 h half-life: 2^(-0.3709 / 36.0) if >= 0 else 0.0",
      },
    ],
    data_quality: "COMPLETE",
    warnings: [
      "Secondary object is a synthetic fragment; trajectory derived from Cowell J2 numerical integration.",
    ],
    scientific_disclaimer: HEURISTIC_RISK_DISCLAIMER,
  },
  {
    event_id: "CONJ-25544-48274-20261102T120530Z",
    primary_object_id: "25544",
    primary_object_name: "ISS (ZARYA)",
    secondary_object_id: "48274",
    secondary_object_name: "CSS (TIANHE)",
    tca: "2026-11-02T12:05:30.412Z",
    miss_distance_km: 8.421,
    relative_speed_kms: 10.842,
    risk_score: 43.77,
    risk_category: "MODERATE",
    evaluation_time: "2026-11-02T12:00:00.000Z",
    factors: [
      {
        factor_name: "MISS_DISTANCE",
        raw_value: 8.421,
        raw_units: "km",
        normalized_value: 0.01484,
        weight: 0.50,
        contribution: 0.74,
        description: "Exponential decay with scale 2.0 km: exp(-8.4210 / 2.0)",
      },
      {
        factor_name: "RELATIVE_SPEED",
        raw_value: 10.842,
        raw_units: "km/s",
        normalized_value: 0.7228,
        weight: 0.25,
        contribution: 18.07,
        description: "Linear ramp clamped at 15.0 km/s: min(10.8420 / 15.0, 1.0)",
      },
      {
        factor_name: "TIME_TO_TCA",
        raw_value: 0.09178,
        raw_units: "hours",
        normalized_value: 0.99823,
        weight: 0.25,
        contribution: 24.96,
        description: "Exponential decay with 36.0 h half-life: 2^(-0.0918 / 36.0) if >= 0 else 0.0",
      },
    ],
    data_quality: "COMPLETE",
    warnings: [],
    scientific_disclaimer: HEURISTIC_RISK_DISCLAIMER,
  },
];

export const MOCK_CONJUNCTION_RESPONSE: ConjunctionScreeningResponse = {
  summary: {
    total_objects: 5,
    total_pairs_considered: 10,
    total_events: 3,
    critical_count: 1,
    high_count: 1,
    moderate_count: 1,
    low_count: 0,
    start_time: "2026-11-02T12:00:00.000Z",
    end_time: "2026-11-02T13:00:00.000Z",
    step_seconds: 60.0,
    threshold_km: 50.0,
    target_frame: "GCRS",
    processed_at: "2026-11-02T12:00:00.000Z",
    execution_time_seconds: 0.185,
    failed_objects_count: 0,
    resolved_objects_count: 5,
    unresolved_norad_ids: [],
  },
  events: MOCK_CONJUNCTION_EVENTS,
  unresolved_norad_ids: [],
  disclaimer: CONJUNCTION_DISCLAIMER,
};

export const MOCK_RISK_BATCH_RESPONSE: RiskAssessmentBatchResponse = {
  total_assessed: 3,
  critical_count: 1,
  high_count: 1,
  moderate_count: 1,
  low_count: 0,
  negligible_count: 0,
  evaluation_time: "2026-11-02T12:00:00.000Z",
  assessments: MOCK_RISK_ASSESSMENTS,
};
