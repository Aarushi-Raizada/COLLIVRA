# COLLIVRA API (`zorbit_api`)

FastAPI backend application for the **COLLIVRA** Space Situational Awareness and Orbital Sustainability Platform.

## Core Services
- **Conjunction Screening:** Vectorized SGP4 propagation and bounded scalar Time of Closest Approach (TCA) numerical minimization.
- **Explainable Risk Engine:** Transparent geometric risk scoring $[0.0 - 1.0]$ with multi-attribute factor breakdowns.
- **Debris Simulation & Remediation:** Cowell DOP853 numerical orbit integration with $J_2$ Earth oblateness and Clohessy-Wiltshire (CW) two-impulse rendezvous planning.
- **Earth Orientation Policy:** Strict validation of IERS Bulletin parameters and Earth orientation quality metadata.
