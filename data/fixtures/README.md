# Offline Fixtures Directory

This directory stores genuine, static offline OMM/GP JSON snapshots retrieved directly from CelesTrak.
These fixtures guarantee offline resilience and fallback capability for testing and demonstrations when CelesTrak is unreachable, offline, or rate-limited.

All records are genuine astronomical ephemeris data retrieved via CelesTrak's GP API. No orbital elements have been fabricated.

## Fixture Provenance & Metadata

### 1. `stations_omm.json`
- **Source:** CelesTrak GP API (`https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=JSON`)
- **Retrieved At:** 2026-11-02T13:20:00Z (UTC)
- **Objects:**
  - `25544` — ISS (ZARYA)
  - `48274` — CSS (TIANHE)
- **Epochs:** 2026-11-01 to 2026-11-02

### 2. `debris_cosmos_omm.json`
- **Source:** CelesTrak GP API (`https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=JSON`)
- **Retrieved At:** 2026-11-02T13:31:00Z (UTC)
- **Objects:**
  - `22675` — COSMOS 2251 (Parent payload)
  - `33757` — COSMOS 2251 DEB (Debris fragment)
  - `33758` — COSMOS 2251 DEB (Debris fragment)
  - `33760` — COSMOS 2251 DEB (Debris fragment)
  - `33761` — COSMOS 2251 DEB (Debris fragment)
- **Epochs:** 2026-11-01 to 2026-11-02

### 3. `starlink_sample_omm.json`
- **Source:** CelesTrak GP API (`https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=JSON`)
- **Retrieved At:** 2026-11-02T13:38:00Z (UTC)
- **Objects:**
  - `53541` — STARLINK-4485
  - `53542` — STARLINK-4489
  - `53543` — STARLINK-4297
  - `53544` — STARLINK-4303
  - `53546` — STARLINK-4477
- **Epochs:** 2026-11-01 to 2026-11-02
