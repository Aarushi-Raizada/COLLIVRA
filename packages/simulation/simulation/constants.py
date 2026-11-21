"""
Constants and defaults for the simplified synthetic collision fragmentation model
and numerical orbital propagation in GCRS.
"""

MODEL_NAME: str = "simplified synthetic fragmentation model"

SIMULATION_DISCLAIMER: str = (
    "Scientific Disclaimer: Simplified synthetic fragmentation model for research and "
    "decision-support. Uses isotropic bounded log-normal ejection delta-v and power-law "
    "mass distribution. Linear momentum and mass are accounted for; kinetic energy is not "
    "conserved. Does NOT possess NASA Standard Breakup Model (SBM) fidelity."
)

PROPAGATION_DISCLAIMER: str = (
    "Scientific Disclaimer: Numerical orbital propagation uses an explicit Dormand-Prince "
    "DOP853 8(5,3) Runge-Kutta integrator with Earth point-mass gravity and J2 oblateness "
    "in GCRS. Earth orientation uses a fixed-epoch Celestial Intermediate Pole (CIP) model. "
    "Does NOT model atmospheric drag, solar radiation pressure, lunar/solar third-body "
    "perturbations, aerothermal demise, or debris ground impact."
)

# Fragmentation defaults (Day 8)
DEFAULT_FRAGMENT_COUNT: int = 500
DEFAULT_MIN_FRAGMENT_MASS_KG: float = 0.01
DEFAULT_MAX_FRAGMENT_MASS_KG: float = 50.0
DEFAULT_V_MEDIAN_KMS: float = 0.10  # 100 m/s in km/s
DEFAULT_V_SIGMA: float = 0.50  # log-dispersion
DEFAULT_MAX_DELTA_V_KMS: float = 1.0  # 1.0 km/s hard ceiling
DEFAULT_POWER_LAW_EXPONENT: float = 1.5  # Differential power-law PDF exponent (alpha)
DEFAULT_MASS_ALLOCATION_FRACTION: float = 0.90  # 90% soft target preference
DEFAULT_COLLISION_TOLERANCE_KM: float = 0.10  # 100 m proximity tolerance
DEFAULT_IDENTIFIER_PREFIX: str = "SYNTH-FRAG"
DEFAULT_SEED: int = 42

# Numerical precision thresholds for fragmentation
NUMERICAL_ZERO_TOLERANCE_MASS_KG: float = 1e-12
MASS_CONSERVATION_TOLERANCE_KG: float = 1e-9
MOMENTUM_CONSERVATION_TOLERANCE_KG_KMS: float = 1e-7

# Astrodynamics & Force Model Constants (Day 9)
# Consistent with WGS-84 / EGM96 standards
MU_EARTH_KM3_S2: float = 398600.4418  # Earth gravitational parameter (GM) in km^3/s^2
R_EARTH_EQUATORIAL_KM: float = 6378.137  # Earth equatorial radius in km
J2_EARTH: float = 1.08262668e-3  # Earth unnormalized second zonal harmonic J2
ATMOSPHERIC_INTERFACE_ALTITUDE_KM: float = 100.0  # Kármán line geometric cutoff in km
R_REENTRY_KM: float = R_EARTH_EQUATORIAL_KM + ATMOSPHERIC_INTERFACE_ALTITUDE_KM  # 6478.137 km

# Numerical Propagation Defaults (Day 9)
DEFAULT_PROPAGATION_DURATION_SECONDS: float = 86400.0  # 24.0 hours
DEFAULT_SAMPLING_STEP_SECONDS: float = 60.0  # 60.0 seconds
DEFAULT_RTOL: float = 1e-8  # Relative integration tolerance
DEFAULT_ATOL_POSITION_KM: float = 1e-9  # Absolute position tolerance: 1 mm (1e-6 m = 1e-9 km)
DEFAULT_ATOL_VELOCITY_KMS: float = 1e-10  # Absolute velocity tolerance: 0.1 um/s (1e-10 km/s)
DEFAULT_MAX_STEP_SECONDS: float = 300.0  # Integrator maximum internal step size (5 minutes)
DEFAULT_INTEGRATOR_METHOD: str = "DOP853"  # 8th-order explicit Runge-Kutta Dormand-Prince

# Output Safeguards & Memory Limits (Day 9)
DEFAULT_MAX_POINTS_PER_TRAJECTORY: int = 10_000  # Max points per single fragment
DEFAULT_MAX_BATCH_POINTS: int = 750_000  # Max total points across all fragments in batch

# Event Detection & Alignment Tolerances
REENTRY_EVENT_TOLERANCE_KM: float = 1e-3  # 1 meter tolerance for root-found reentry radius
ENDPOINT_TIME_TOLERANCE_SECONDS: float = 1e-6  # Timestamp equality tolerance

# Sampling Guardrails for Rendezvous Targeting (Milestone 5.3.4.4)
# Conservative engineering recommendation derived from O(h^4) cubic Hermite
# curvature error in near-circular LEO orbits (keeps position interpolation error < 0.36 m,
# safely within the 1.0 m cross-check tolerance).
MAX_TARGETING_KNOT_STEP_SECONDS: float = 60.0
