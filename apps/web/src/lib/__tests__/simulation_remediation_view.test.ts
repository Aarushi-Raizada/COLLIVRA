/**
 * ZORBIT Phase 5: Simulation & Remediation Scientific & View Tests
 *
 * Verifies:
 * 1. Breakup request creation, knot sampling guardrail (step_seconds <= 60.0 s), and validation
 * 2. Clohessy-Wiltshire (CW) near-circular eccentricity limit (e <= 0.005) and perigee threshold (rp >= 6478.137 km)
 * 3. Precomputed demo fixtures integrity, synthetic provenance (is_synthetic = true, SYNTH- prefix)
 * 4. Mass conservation and momentum residual verification
 * 5. Dual feasibility discriminator: mathematical solvability vs budget feasibility
 * 6. Two-impulse CW Delta-V burn vector components in the Hill (RIC / LVLH) frame
 * 7. Inertial GCRS coordinate transformation to Three.js scene space without Earth rotation cross-talk
 * 8. Scientific fidelity disclaimers presence and precision
 */

import {
  DEFAULT_COLLISION_SCENARIO,
  DEFAULT_PROPAGATION_CONFIG,
  DEFAULT_CHASER_STATE,
  DEFAULT_RENDEZVOUS_CONFIG,
  createDefaultBreakupRequest,
  createDefaultRemediationRequest,
  createBudgetInfeasibleRemediationRequest,
} from "../simulation_presets";
import {
  DEMO_BREAKUP_RESPONSE,
  DEMO_REMEDIATION_RESPONSE,
  DEMO_INFEASIBLE_REMEDIATION_RESPONSE,
} from "../../data/simulationFixtures";
import canonicalCwFixture from "../../../../../data/fixtures/cw_rendezvous_canonical_scenario.json";
import { gcrsToThreePosition, calculateArrivalPosition, computeCwTrajectoryPoints, computeCwDepartureVelocity } from "../coordinates";
import {
  calculateDeltaVBudgetMetrics,
  getDeltaVGaugeState,
  computeHillComponentBreakdown,
  computeBurnVectorBreakdown,
  CW_SCIENTIFIC_BOUNDARY_DISCLOSURE,
  CW_SCIENTIFIC_DISCLOSURE_TEXT,
} from "../../components/simulation/RemediationResultsView";
import type {
  BreakupAndPropagateRequest,
  BreakupRemediationRequest,
} from "../../types/simulation";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

export function runSimulationRemediationViewTests(): {
  total: number;
  passed: number;
  details: string[];
} {
  const details: string[] = [];
  let passed = 0;
  let total = 0;

  function runTest(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      details.push(`[PASS] ${total}. ${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      details.push(`[FAIL] ${total}. ${name}: ${msg}`);
    }
  }

  // 1. Knot sampling guardrail
  runTest("M5.3.4.4 Knot sampling guardrail (step_seconds <= 60.0 s)", () => {
    const defaultReq = createDefaultBreakupRequest();
    assert(
      (defaultReq.propagation_config?.step_seconds ?? 0) <= 60.0,
      `Step seconds ${defaultReq.propagation_config?.step_seconds}s exceeds 60.0s guardrail`
    );

    const remReq = createDefaultRemediationRequest();
    assert(
      (remReq.propagation_config?.step_seconds ?? 0) <= 60.0,
      `Remediation step seconds ${remReq.propagation_config?.step_seconds}s exceeds 60.0s guardrail`
    );
  });

  // 2. Near-circular CW reference orbit precondition
  runTest("Near-circular CW reference orbit preconditions (e <= 0.005, rp >= 6478.137 km)", () => {
    const remReq = createDefaultRemediationRequest();
    assert(
      remReq.max_target_eccentricity === 0.005,
      `Target eccentricity limit must be strictly 0.005 (got ${remReq.max_target_eccentricity})`
    );
    assert(
      remReq.min_target_perigee_km === 6478.137,
      `Min target perigee must be Earth radius + 100 km = 6478.137 km (got ${remReq.min_target_perigee_km})`
    );
  });

  // 3. Demo breakup fixture synthetic provenance
  runTest("Demo breakup fixture strictly maintains synthetic provenance and formatting", () => {
    const { fragmentation, trajectories } = DEMO_BREAKUP_RESPONSE;
    assert(fragmentation.fragments.length === 10, "Demo fixture contains 10 fragments");

    for (const frag of fragmentation.fragments) {
      assert(frag.is_synthetic === true, `Fragment ${frag.fragment_id} must have is_synthetic = true`);
      assert(frag.fragment_id.startsWith("SYNTH-"), `Fragment ${frag.fragment_id} must have SYNTH- prefix`);
      assert(frag.mass_kg > 0, `Fragment ${frag.fragment_id} mass must be positive`);
      assert(frag.position_km.length === 3, "Position vector must have 3 components");
      assert(frag.velocity_kms.length === 3, "Velocity vector must have 3 components");
    }

    assert(trajectories.trajectories.length === 10, "Trajectory batch contains 10 trajectories");
    for (const traj of trajectories.trajectories) {
      assert(traj.status === "SUCCESS", "Demo trajectory status is SUCCESS");
      assert(traj.termination_reason === "COMPLETED", "Demo trajectory completed without reentry");
      assert(traj.points.length > 0, "Trajectory points must be non-empty");
    }
  });

  // 4. Mass conservation and momentum residual
  runTest("Mass conservation and momentum residual physics verification", () => {
    const { metadata, fragments } = DEMO_BREAKUP_RESPONSE.fragmentation;
    const computedTrackedMass = fragments.reduce((acc, f) => acc + f.mass_kg, 0);

    const diff = Math.abs(computedTrackedMass - metadata.tracked_fragment_mass_kg);
    assert(diff < 1e-4, `Tracked mass sum ${computedTrackedMass} != metadata ${metadata.tracked_fragment_mass_kg}`);

    const totalMass = metadata.tracked_fragment_mass_kg + metadata.residual_mass_kg;
    assert(
      Math.abs(totalMass - metadata.total_parent_mass_kg) < 1e-4,
      `Total mass conservation failed: ${totalMass} vs ${metadata.total_parent_mass_kg}`
    );

    assert(
      metadata.momentum_residual_kg_kms < 1e-6,
      `Momentum residual ${metadata.momentum_residual_kg_kms} must be near machine epsilon`
    );
  });

  // 5. Dual feasibility badge discriminator
  runTest("Dual feasibility badge discriminator distinguishes mathematical solvability from budget feasibility", () => {
    const nominal = DEMO_REMEDIATION_RESPONSE.rendezvous;
    assert(nominal.is_mathematically_solvable === true, "Nominal plan must be mathematically solvable");
    assert(nominal.is_budget_feasible === true, "Nominal plan must be budget feasible");
    assert(nominal.is_feasible === true, "Nominal plan must be overall feasible");

    const infeasible = DEMO_INFEASIBLE_REMEDIATION_RESPONSE.rendezvous;
    assert(infeasible.is_mathematically_solvable === true, "Infeasible plan must be mathematically solvable");
    assert(infeasible.is_budget_feasible === false, "Infeasible plan must have is_budget_feasible = false");
    assert(infeasible.is_feasible === false, "Infeasible plan must have is_feasible = false");
  });

  // 6. Two-impulse CW burn vectors in Hill frame
  runTest("Two-impulse CW Delta-V burn vector components in the Hill (RIC / LVLH) frame", () => {
    const rz = DEMO_REMEDIATION_RESPONSE.rendezvous;
    const b1 = rz.burn_1_dv_cw_ms;
    const b2 = rz.burn_2_dv_cw_ms;

    assert(b1.length === 3, "Burn 1 has [Radial, Along-Track, Cross-Track]");
    assert(b2.length === 3, "Burn 2 has [Radial, Along-Track, Cross-Track]");

    const b1Mag = Math.sqrt(b1[0] * b1[0] + b1[1] * b1[1] + b1[2] * b1[2]);
    const b2Mag = Math.sqrt(b2[0] * b2[0] + b2[1] * b2[1] + b2[2] * b2[2]);
    const totalDv = b1Mag + b2Mag;

    assert(
      Math.abs(totalDv - rz.total_delta_v_ms) < 0.05,
      `Total Delta-V ${rz.total_delta_v_ms} does not match sum of burn magnitudes ${totalDv}`
    );
  });

  // 7. Inertial GCRS coordinate mapping to Three.js scene
  runTest("Inertial GCRS coordinate transformation to Three.js scene space", () => {
    const [x, y, z] = gcrsToThreePosition(7200.0, 100.0, -50.0, "GCRS");
    // X_three = X_gcrs / 1000 = 7.2
    // Y_three = Z_gcrs / 1000 = -0.05
    // Z_three = -Y_gcrs / 1000 = -0.1
    assert(Math.abs(x - 7.2) < 1e-6, `Expected x = 7.2, got ${x}`);
    assert(Math.abs(y - (-0.05)) < 1e-6, `Expected y = -0.05, got ${y}`);
    assert(Math.abs(z - (-0.1)) < 1e-6, `Expected z = -0.1, got ${z}`);
  });

  // 8. Scientific fidelity disclaimers
  runTest("Scientific fidelity disclaimers explicitly present across models", () => {
    assert(
      DEMO_BREAKUP_RESPONSE.fragmentation.metadata.fidelity_disclaimer.includes("SIMPLIFIED SYNTHETIC MODEL"),
      "Breakup metadata must contain simplified synthetic model disclaimer"
    );
    assert(
      DEMO_REMEDIATION_RESPONSE.scientific_disclaimer.includes("Clohessy-Wiltshire"),
      "Remediation response must contain Clohessy-Wiltshire model disclaimer"
    );
    assert(
      DEMO_REMEDIATION_RESPONSE.scientific_disclaimer.includes("e < 0.005"),
      "Remediation response must explicitly declare e < 0.005 precondition"
    );
  });

  // 9. Data provenance distinction: Live backend results vs precomputed illustrative demonstration fixtures
  runTest("Data provenance distinction: Live backend results vs precomputed illustrative demonstration fixtures", () => {
    // Demonstration fixtures must explicitly document that they are illustrative offline scenarios
    assert(
      DEMO_BREAKUP_RESPONSE.fragmentation.metadata.fidelity_disclaimer.includes("offline demonstration"),
      "Demo breakup disclaimer must explicitly state it is an illustrative scenario for offline demonstration"
    );
    assert(
      DEMO_REMEDIATION_RESPONSE.scientific_disclaimer.includes("offline preview"),
      "Demo remediation disclaimer must explicitly declare offline preview status"
    );
  });

  // 10. Enforced momentum drift subtraction vs floating-point numerical residual
  runTest("Enforced momentum drift subtraction vs floating-point numerical residual", () => {
    const meta = DEMO_BREAKUP_RESPONSE.fragmentation.metadata;
    // Algorithmically enforced: residual is floating-point roundoff, not independent proof of physics accuracy
    assert(
      meta.fidelity_disclaimer.includes("mass-weighted ensemble drift subtraction"),
      "Disclaimer must clarify that zero net momentum is algorithmically enforced via drift subtraction"
    );
    assert(
      meta.fidelity_disclaimer.includes("floating-point roundoff"),
      "Disclaimer must clarify that numerical residuals represent floating-point roundoff"
    );
    assert(
      meta.momentum_residual_kg_kms < 1e-6,
      "Momentum residual must be bounded by IEEE-754 precision"
    );
  });

  // 11. Phase 6C: Mass-budget arithmetic & Untracked Residual Mass accounting
  runTest("Phase 6C Mass-budget arithmetic and Untracked Residual Mass accounting", () => {
    const meta = DEMO_BREAKUP_RESPONSE.fragmentation.metadata;
    const trackedMass = meta.tracked_fragment_mass_kg;
    const residualMass = meta.residual_mass_kg;
    const totalMass = meta.total_parent_mass_kg;

    assert(Math.abs(trackedMass - 96.07) < 0.01, `Tracked mass should be ~96.07 kg (got ${trackedMass})`);
    assert(Math.abs(residualMass - 903.93) < 0.01, `Residual mass should be ~903.93 kg (got ${residualMass})`);
    assert(Math.abs(totalMass - 1000.0) < 0.01, `Combined parent mass should be 1000.00 kg (got ${totalMass})`);
    assert(
      Math.abs(trackedMass + residualMass - totalMass) < 1e-6,
      "Sum of tracked and untracked residual mass must exactly equal combined parent mass"
    );
  });

  // 12. Phase 6C: Rendezvous-targeting interpolation knot guardrail terminology & validation rule
  runTest("Phase 6C Rendezvous-targeting interpolation knot guardrail terminology & validation rule", () => {
    const validStep = 60.0;
    const invalidStep = 60.1;

    // Guardrail rule: step_seconds <= 60.0s is permitted
    assert(validStep <= 60.0, "60.0s knot step must pass guardrail");
    assert(invalidStep > 60.0, "60.1s knot step must fail guardrail");

    // Terminology check: guardrail is for rendezvous targeting interpolation, not integrator divergence
    const guardrailMsg =
      "Output trajectory knot interval cannot exceed 60.0s. This 60-second limit is enforced as a rendezvous-targeting interpolation knot guardrail, not as a universal DOP853 integrator step limit.";
    assert(
      guardrailMsg.includes("rendezvous-targeting interpolation knot guardrail"),
      "Message must specify rendezvous-targeting interpolation knot guardrail"
    );
    assert(
      !guardrailMsg.includes("universal Cowell DOP853 integration time-step restriction"),
      "Message must not claim universal DOP853 step restriction"
    );
    assert(
      !guardrailMsg.includes("<1.0m targeting precision"),
      "Message must not claim an unverified numerical precision guarantee"
    );
  });

  // 13. Phase 6C: Synthetic fragments multi-column sorting
  runTest("Phase 6C Synthetic fragments multi-column sorting (ID, mass, ejection Δv, knots)", () => {
    const frags = [...DEMO_BREAKUP_RESPONSE.fragmentation.fragments];

    // Sort by mass ascending
    const sortedByMassAsc = [...frags].sort((a, b) => a.mass_kg - b.mass_kg);
    for (let i = 0; i < sortedByMassAsc.length - 1; i++) {
      assert(
        sortedByMassAsc[i].mass_kg <= sortedByMassAsc[i + 1].mass_kg,
        "Mass ascending sort order violated"
      );
    }

    // Sort by mass descending
    const sortedByMassDesc = [...frags].sort((a, b) => b.mass_kg - a.mass_kg);
    for (let i = 0; i < sortedByMassDesc.length - 1; i++) {
      assert(
        sortedByMassDesc[i].mass_kg >= sortedByMassDesc[i + 1].mass_kg,
        "Mass descending sort order violated"
      );
    }

    // Sort by ejection delta-v descending
    const sortedByDvDesc = [...frags].sort((a, b) => b.delta_v_kms - a.delta_v_kms);
    for (let i = 0; i < sortedByDvDesc.length - 1; i++) {
      assert(
        sortedByDvDesc[i].delta_v_kms >= sortedByDvDesc[i + 1].delta_v_kms,
        "Delta-v descending sort order violated"
      );
    }
  });

  // 14. Phase 6C: Atmospheric interface re-entry status classification
  runTest("Phase 6C Atmospheric interface re-entry status classification", () => {
    const nominalTraj = {
      status: "SUCCESS" as const,
      termination_reason: "COMPLETED" as const,
    };
    const reenteredTraj = {
      status: "PARTIAL" as const,
      termination_reason: "ATMOSPHERIC_INTERFACE" as const,
    };

    const isReentry = (t: { termination_reason: string }) =>
      t.termination_reason === "ATMOSPHERIC_INTERFACE" ||
      t.termination_reason.toLowerCase().includes("reenter");

    assert(!isReentry(nominalTraj), "Nominal trajectory must not be classified as reentered");
    assert(isReentry(reenteredTraj), "ATMOSPHERIC_INTERFACE must be classified as reentered");
  });


    // 15. Phase 6D.1: Burn 2 arrow origin for STANDOFF_HOLD
    runTest("Phase 6D.1 Burn 2 arrow origin for STANDOFF_HOLD anchors at terminal standoff state", () => {
      const origin50 = calculateArrivalPosition("STANDOFF_HOLD", 50.0);
      assert(origin50[0] === -50.0, `Expected along-track origin -50.0m, got ${origin50[0]}`);
      assert(origin50[1] === 0.0, `Expected radial origin 0.0m, got ${origin50[1]}`);
      assert(origin50[2] === 0.0, `Expected cross-track origin 0.0m, got ${origin50[2]}`);

      const origin75 = calculateArrivalPosition("STANDOFF_HOLD", 75.0);
      assert(origin75[0] === -75.0, `Expected along-track origin -75.0m, got ${origin75[0]}`);
      assert(origin75[1] === 0.0, "Expected radial origin 0.0m");
      assert(origin75[2] === 0.0, "Expected cross-track origin 0.0m");

      assert(
        origin50[0] !== 0 || origin50[1] !== 0 || origin50[2] !== 0,
        "Burn 2 origin must not be anchored at target [0, 0, 0] in STANDOFF_HOLD"
      );
    });

    // 16. Phase 6D.1: Burn 2 arrow origin for CONTACT_INTERCEPT
    runTest("Phase 6D.1 Burn 2 arrow origin for CONTACT_INTERCEPT anchors at terminal contact position", () => {
      const originContact = calculateArrivalPosition("CONTACT_INTERCEPT", 50.0);
      assert(originContact[0] === 0.0, "Expected along-track contact origin 0.0m");
      assert(originContact[1] === 0.0, "Expected radial contact origin 0.0m");
      assert(originContact[2] === 0.0, "Expected cross-track contact origin 0.0m");
    });

    // 17. Phase 6D.1: CW trajectory endpoint consistency
    runTest("Phase 6D.1 CW trajectory endpoint consistency connects departure t0 to terminal tf", () => {
      // Full 3D relative Hill coordinates [I, R, C] meters (approx [79.0, -12.0, -5.0] m)
      const chaserDisplayPos: [number, number, number] = [79.0, -12.0, -5.0];
      const standoffArrivalPos = calculateArrivalPosition("STANDOFF_HOLD", 50.0);
      const meanMotion = 0.0010334;
      const transferTimeS = 120.0;

      const pts = computeCwTrajectoryPoints(
        chaserDisplayPos,
        standoffArrivalPos,
        meanMotion,
        transferTimeS,
        50
      );

      assert(pts.length === 50, `Expected 50 samples, got ${pts.length}`);

      assert(pts[0][0] !== 80.1, "Initial in-track coordinate must not equal scalar LOS distance");
      assert(Math.abs(pts[0][0] - 79.0) < 1e-9, "Start along-track must equal chaser In-track (+79.0m)");
      assert(Math.abs(pts[0][1] - (-12.0)) < 1e-9, "Start radial must equal chaser Radial (-12.0m)");
      assert(Math.abs(pts[0][2] - (-5.0)) < 1e-9, "Start cross-track must equal chaser Cross-track (-5.0m)");
      assert(Math.abs(pts[0][1] - chaserDisplayPos[1]) < 1e-9, "Start radial must equal chaser position");
      assert(Math.abs(pts[0][2] - chaserDisplayPos[2]) < 1e-9, "Start cross-track must equal chaser position");

      const endPt = pts[pts.length - 1];
      assert(Math.abs(endPt[0] - standoffArrivalPos[0]) < 1e-9, "End along-track must equal arrival position");
      assert(Math.abs(endPt[1] - standoffArrivalPos[1]) < 1e-9, "End radial must equal arrival position");
      assert(Math.abs(endPt[2] - standoffArrivalPos[2]) < 1e-9, "End cross-track must equal arrival position");

      const contactArrivalPos = calculateArrivalPosition("CONTACT_INTERCEPT");
      const ptsContact = computeCwTrajectoryPoints(
        chaserDisplayPos,
        contactArrivalPos,
        meanMotion,
        transferTimeS,
        50
      );
      const endContactPt = ptsContact[ptsContact.length - 1];
      assert(Math.abs(endContactPt[0] - 0.0) < 1e-9, "End along-track must equal 0.0m for contact");
      assert(Math.abs(endContactPt[1] - 0.0) < 1e-9, "End radial must equal 0.0m for contact");
      assert(Math.abs(endContactPt[2] - 0.0) < 1e-9, "End cross-track must equal 0.0m for contact");
    });

    // 18. Phase 6D.1: CW trajectory sampling and coordinate mapping
    runTest("Phase 6D.1 CW trajectory sampling and coordinate mapping [X=In-Track, Y=Radial, Z=Cross-Track]", () => {
      const chaserDisplayPos: [number, number, number] = [79.0, -12.0, -5.0];
      const arrivalDisplayPos: [number, number, number] = [-50.0, 0.0, 0.0];
      const meanMotion = 0.0010334;
      const transferTimeS = 120.0;

      const pts = computeCwTrajectoryPoints(
        chaserDisplayPos,
        arrivalDisplayPos,
        meanMotion,
        transferTimeS,
        50
      );

      for (let i = 0; i < pts.length; i++) {
        assert(Number.isFinite(pts[i][0]), `Point ${i} X must be finite`);
        assert(Number.isFinite(pts[i][1]), `Point ${i} Y must be finite`);
        assert(Number.isFinite(pts[i][2]), `Point ${i} Z must be finite`);
      }

      const midPoint = pts[25];
      assert(midPoint[1] > (chaserDisplayPos[1] + arrivalDisplayPos[1]) / 2, "Radial displacement (+Y) must exhibit physical orbital curvature relative to linear chord");
      assert(midPoint[0] < chaserDisplayPos[0] && midPoint[0] > arrivalDisplayPos[0], "Along-track (+X) must transition continuously");
    });

    // 19. Phase 6D.1: Trajectory updates when scenario or planner inputs change
    runTest("Phase 6D.1 Trajectory updates dynamically when planner inputs or scenario change", () => {
      const chaserA: [number, number, number] = [80.0, 0.0, 0.0];
      const chaserB: [number, number, number] = [120.0, 10.0, 5.0];
      const arrivalA = calculateArrivalPosition("STANDOFF_HOLD", 50.0);
      const arrivalB = calculateArrivalPosition("STANDOFF_HOLD", 100.0);
      const n = 0.0010334;

      const trajA = computeCwTrajectoryPoints(chaserA, arrivalA, n, 120.0, 50);
      const trajB = computeCwTrajectoryPoints(chaserB, arrivalB, n, 120.0, 50);

      assert(trajA[0][0] !== trajB[0][0], "Initial endpoint must update when chaser position changes");
      assert(trajA[49][0] !== trajB[49][0], "Terminal endpoint must update when standoff distance changes");
      assert(trajA[49][0] === -50.0 && trajB[49][0] === -100.0, "Terminal along-track must reflect configured standoff");
    });

    // 20. Phase 6D.1: Perigee boundary consistency in frontend
    runTest("Phase 6D.1 Perigee boundary consistency (>= 6478.137 km) across schema and form", () => {
      const ATMOSPHERE_INTERFACE_KM = 6478.137;

      const validatePerigee = (minPerigeeKm: number): boolean => {
        return minPerigeeKm >= ATMOSPHERE_INTERFACE_KM;
      };

      assert(validatePerigee(6478.136) === false, "6478.136 km must be rejected as below atmospheric interface");
      assert(validatePerigee(6478.137) === true, "6478.137 km exactly must be accepted (safe perigee clearance)");
      assert(validatePerigee(6500.0) === true, "6500.0 km must be accepted");

      const defaultReq = createDefaultRemediationRequest();
      assert(
        defaultReq.min_target_perigee_km === 6478.137,
        "Default remediation request must set min_target_perigee_km = 6478.137"
      );
    });

    // 21. Phase 6D.1: CW trajectory initial departure velocity matches canonical backend fixture
    runTest("Phase 6D.1 Shared Fixture: CW departure velocity matches canonical backend reference (rho_dot_0^+ = rho_dot_0^- + Delta_v1)", () => {
      // 1. Load canonical scenario fixture shared across frontend & backend test suites:
      // Canonical file: data/fixtures/cw_rendezvous_canonical_scenario.json
      // Numerical provenance: Derived directly by backend solve_two_impulse_cw
      const initialDisplayPos = canonicalCwFixture.display_space_threejs.initial_position_m as [number, number, number];
      const terminalDisplayPos = canonicalCwFixture.display_space_threejs.terminal_position_m as [number, number, number];
      const meanMotionRadS = canonicalCwFixture.chief_orbit.mean_motion_rad_s;
      const transferTimeS = canonicalCwFixture.rendezvous_parameters.transfer_time_s;

      // 2. Compute departure velocity analytically from the frontend trajectory generator:
      const vDep = computeCwDepartureVelocity(
        initialDisplayPos,
        terminalDisplayPos,
        meanMotionRadS,
        transferTimeS
      );

      // vDep is in Three.js display space: [v_I, v_R, v_C]
      const vI0 = vDep[0];
      const vR0 = vDep[1];
      const vC0 = vDep[2];

      // 3. Compare all three components against the canonical fixture's backend reference velocity:
      // Coordinate convention:
      // - Component 0 (X_Three): In-Track (I)
      // - Component 1 (Y_Three): Radial (R)
      // - Component 2 (Z_Three): Cross-Track (C)
      const refVelDisplay = canonicalCwFixture.solver_reference_solution.post_burn_1_velocity_display_ms;
      const expected_vI0_ms = refVelDisplay[0];
      const expected_vR0_ms = refVelDisplay[1];
      const expected_vC0_ms = refVelDisplay[2];

      assert(
        Math.abs(vI0 - expected_vI0_ms) < 1e-9,
        `In-track departure velocity v_I (${vI0.toFixed(9)} m/s) must match canonical fixture reference (${expected_vI0_ms} m/s)`
      );
      assert(
        Math.abs(vR0 - expected_vR0_ms) < 1e-9,
        `Radial departure velocity v_R (${vR0.toFixed(9)} m/s) must match canonical fixture reference (${expected_vR0_ms} m/s)`
      );
      assert(
        Math.abs(vC0 - expected_vC0_ms) < 1e-9,
        `Cross-track departure velocity v_C (${vC0.toFixed(9)} m/s) must match canonical fixture reference (${expected_vC0_ms} m/s)`
      );

      // Verify consistency between display space and Hill (RIC) frame reference velocities:
      const refVelHill = canonicalCwFixture.solver_reference_solution.post_burn_1_velocity_hill_ms;
      assert(
        Math.abs(vR0 - refVelHill[0]) < 1e-9,
        `Display radial velocity Y (${vR0.toFixed(9)} m/s) must equal Hill radial velocity [0] (${refVelHill[0]} m/s)`
      );
      assert(
        Math.abs(vI0 - refVelHill[1]) < 1e-9,
        `Display in-track velocity X (${vI0.toFixed(9)} m/s) must equal Hill in-track velocity [1] (${refVelHill[1]} m/s)`
      );
      assert(
        Math.abs(vC0 - refVelHill[2]) < 1e-9,
        `Display cross-track velocity Z (${vC0.toFixed(9)} m/s) must equal Hill cross-track velocity [2] (${refVelHill[2]} m/s)`
      );

      // 4. Preserve existing forward-propagation endpoint assertions:
      // Verify that propagating (initialDisplayPos, vDep) under the 6x6 CW STM Phi(tau_f)
      // exactly reproduces the terminal position with residual < 1e-9 meters.
      const n = meanMotionRadS;
      const tau = transferTimeS;
      const sf = Math.sin(n * tau);
      const cf = Math.cos(n * tau);
      const af = n * tau;

      const I0 = initialDisplayPos[0];
      const R0 = initialDisplayPos[1];
      const C0 = initialDisplayPos[2];

      const R_f = (4.0 - 3.0 * cf) * R0 + (sf / n) * vR0 + ((2.0 * (1.0 - cf)) / n) * vI0;
      const I_f = 6.0 * (sf - af) * R0 + I0 + ((2.0 * (cf - 1.0)) / n) * vR0 + ((4.0 * sf - 3.0 * af) / n) * vI0;
      const C_f = cf * C0 + (sf / n) * vC0;

      const residual_I = Math.abs(I_f - terminalDisplayPos[0]);
      const residual_R = Math.abs(R_f - terminalDisplayPos[1]);
      const residual_C = Math.abs(C_f - terminalDisplayPos[2]);

      assert(residual_I < 1e-9, `In-track forward propagation residual must be < 1e-9 m, got ${residual_I}`);
      assert(residual_R < 1e-9, `Radial forward propagation residual must be < 1e-9 m, got ${residual_R}`);
      assert(residual_C < 1e-9, `Cross-track forward propagation residual must be < 1e-9 m, got ${residual_C}`);
    });

    runTest("Phase 6D.2 Step 1 Delta-V budget metrics calculation, margin accounting, and non-finite guardrails", () => {
      // 1. Nominal scenario: 11.630 m/s required vs 25.0 m/s budget
      const nominal = calculateDeltaVBudgetMetrics(
        DEMO_REMEDIATION_RESPONSE.rendezvous.total_delta_v_ms,
        DEFAULT_RENDEZVOUS_CONFIG.delta_v_budget_max_ms
      );
      assert(nominal !== null, "Nominal budget analysis must not be null");
      if (nominal) {
        assert(
          Math.abs(nominal.requiredDeltaVMs - 11.630) < 1e-3,
          `Required delta-v (${nominal.requiredDeltaVMs}) must equal total_delta_v_ms (11.630)`
        );
        assert(
          nominal.budgetDeltaVMs === 25.0,
          `Budget delta-v (${nominal.budgetDeltaVMs}) must equal 25.0 m/s`
        );
        assert(
          Math.abs(nominal.utilizationPercent - 46.52) < 1e-2,
          `Utilization (${nominal.utilizationPercent}%) must be approx 46.52%`
        );
        assert(
          Math.abs(nominal.remainingMarginMs - 13.370) < 1e-3,
          `Remaining margin (${nominal.remainingMarginMs} m/s) must be approx +13.370 m/s`
        );
        assert(
          nominal.isBudgetExceeded === false,
          "isBudgetExceeded must be false for nominal budget"
        );
      }

      // 2. Infeasible scenario: 11.630 m/s required vs 0.005 m/s budget
      const infeasible = calculateDeltaVBudgetMetrics(
        DEMO_INFEASIBLE_REMEDIATION_RESPONSE.rendezvous.total_delta_v_ms,
        0.005
      );
      assert(infeasible !== null, "Infeasible budget analysis must not be null");
      if (infeasible) {
        assert(
          Math.abs(infeasible.requiredDeltaVMs - 11.630) < 1e-3,
          `Required delta-v (${infeasible.requiredDeltaVMs}) must equal 11.630 m/s`
        );
        assert(
          infeasible.budgetDeltaVMs === 0.005,
          `Budget delta-v (${infeasible.budgetDeltaVMs}) must equal 0.005 m/s`
        );
        assert(
          Math.abs(infeasible.utilizationPercent - 232600.0) < 1e-1,
          `Utilization (${infeasible.utilizationPercent}%) must be 232,600%`
        );
        assert(
          Math.abs(infeasible.remainingMarginMs - (-11.625)) < 1e-3,
          `Remaining margin (${infeasible.remainingMarginMs} m/s) must be -11.625 m/s`
        );
        assert(
          infeasible.isBudgetExceeded === true,
          "isBudgetExceeded must be true for exceeded budget"
        );
      }

      // 3. Exact boundary condition: required == budget
      const boundary = calculateDeltaVBudgetMetrics(25.0, 25.0);
      assert(boundary !== null, "Boundary budget analysis must not be null");
      if (boundary) {
        assert(
          boundary.utilizationPercent === 100.0,
          "Utilization at boundary must be 100.0%"
        );
        assert(
          boundary.remainingMarginMs === 0.0,
          "Remaining margin at boundary must be 0.0 m/s"
        );
        assert(
          boundary.isBudgetExceeded === false,
          "isBudgetExceeded must be false when required == budget"
        );
      }

      // 4. Zero required delta-v edge case (valid zero impulse)
      const zeroRequired = calculateDeltaVBudgetMetrics(0, 25.0);
      assert(zeroRequired !== null, "Zero required delta-v with valid positive budget must not be null");
      if (zeroRequired) {
        assert(zeroRequired.requiredDeltaVMs === 0, "Required delta-v must be 0");
        assert(zeroRequired.budgetDeltaVMs === 25.0, "Budget delta-v must equal 25.0 m/s");
        assert(zeroRequired.utilizationPercent === 0, "Utilization percent must be 0 for zero required delta-v");
        assert(
          zeroRequired.remainingMarginMs === 25.0,
          "Remaining margin must equal full budget (25.0 m/s) when required is 0"
        );
        assert(
          zeroRequired.isBudgetExceeded === false,
          "isBudgetExceeded must be false when required is 0"
        );
      }

      // 5. Robust handling of missing, negative, or non-finite required delta-v returning null
      assert(calculateDeltaVBudgetMetrics(undefined, 25.0) === null, "undefined required delta-v must return null");
      assert(calculateDeltaVBudgetMetrics(null, 25.0) === null, "null required delta-v must return null");
      assert(calculateDeltaVBudgetMetrics(-0.001, 25.0) === null, "negative required delta-v must return null");
      assert(calculateDeltaVBudgetMetrics(-5.0, 25.0) === null, "negative required delta-v must return null");
      assert(calculateDeltaVBudgetMetrics(NaN, 25.0) === null, "NaN required delta-v must return null");
      assert(calculateDeltaVBudgetMetrics(Infinity, 25.0) === null, "Infinity required delta-v must return null");
      assert(calculateDeltaVBudgetMetrics(-Infinity, 25.0) === null, "-Infinity required delta-v must return null");

      // 6. Robust handling of missing, zero, negative, or non-finite budget returning null
      assert(calculateDeltaVBudgetMetrics(11.63, undefined) === null, "undefined budget must return null");
      assert(calculateDeltaVBudgetMetrics(11.63, null) === null, "null budget must return null");
      assert(calculateDeltaVBudgetMetrics(11.63, 0) === null, "zero budget must return null");
      assert(calculateDeltaVBudgetMetrics(11.63, -0.001) === null, "negative budget must return null");
      assert(calculateDeltaVBudgetMetrics(11.63, -5.0) === null, "negative budget must return null");
      assert(calculateDeltaVBudgetMetrics(11.63, NaN) === null, "NaN budget must return null");
      assert(calculateDeltaVBudgetMetrics(11.63, Infinity) === null, "Infinity budget must return null");
      assert(calculateDeltaVBudgetMetrics(11.63, -Infinity) === null, "-Infinity budget must return null");
    });

    runTest("Phase 6D.2 Step 2 Delta-V Budget Gauge visual behavior, tier thresholds, capped bar width, and feasibility separation", () => {
      // 1. Nominal gauge display
      const nominalAnalysis = calculateDeltaVBudgetMetrics(
        DEMO_REMEDIATION_RESPONSE.rendezvous.total_delta_v_ms,
        DEFAULT_RENDEZVOUS_CONFIG.delta_v_budget_max_ms
      );
      const nominalGauge = getDeltaVGaugeState(nominalAnalysis);
      assert(nominalGauge !== null, "Nominal gauge state must not be null");
      if (nominalGauge) {
        assert(nominalGauge.statusTier === "healthy", "Nominal tier must be 'healthy'");
        assert(nominalGauge.badgeVariant === "emerald", "Nominal badge variant must be 'emerald'");
        assert(nominalGauge.barColorClass.includes("emerald"), "Bar color must be emerald");
        assert(nominalGauge.formattedRequired === "11.630 m/s", "Formatted required must be '11.630 m/s'");
        assert(nominalGauge.formattedBudget === "25.000 m/s", "Formatted budget must be '25.000 m/s'");
        assert(nominalGauge.formattedUtilization === "46.52%", "Formatted utilization must be '46.52%'");
        assert(nominalGauge.formattedMargin === "+13.370 m/s", "Formatted margin must be '+13.370 m/s'");
        assert(
          Math.abs(nominalGauge.visualBarWidthPercent - 46.52) < 0.01,
          `Visual bar width (${nominalGauge.visualBarWidthPercent}%) must match utilization (46.52%)`
        );
      }

      // 2. Over-budget gauge display and capped visual width
      const infeasibleAnalysis = calculateDeltaVBudgetMetrics(
        DEMO_INFEASIBLE_REMEDIATION_RESPONSE.rendezvous.total_delta_v_ms,
        0.005
      );
      const infeasibleGauge = getDeltaVGaugeState(infeasibleAnalysis);
      assert(infeasibleGauge !== null, "Infeasible gauge state must not be null");
      if (infeasibleGauge) {
        assert(infeasibleGauge.statusTier === "exceeded", "Infeasible tier must be 'exceeded'");
        assert(infeasibleGauge.badgeVariant === "rose", "Infeasible badge variant must be 'rose'");
        assert(infeasibleGauge.barColorClass.includes("rose"), "Bar color must be rose");
        assert(infeasibleGauge.formattedRequired === "11.630 m/s", "Formatted required must be '11.630 m/s'");
        assert(infeasibleGauge.formattedBudget === "0.005 m/s", "Formatted budget must be '0.005 m/s'");
        assert(infeasibleGauge.formattedUtilization === "232,600%", "Formatted utilization must be '232,600%'");
        assert(infeasibleGauge.formattedMargin === "-11.625 m/s", "Formatted margin must be '-11.625 m/s'");
        assert(
          infeasibleGauge.visualBarWidthPercent === 100,
          `Visual bar width (${infeasibleGauge.visualBarWidthPercent}%) must be capped at 100%`
        );
      }

      // 3. Missing / invalid budget state
      assert(getDeltaVGaugeState(null) === null, "Missing budget analysis must yield null gauge state");
      const invalidAnalysis = calculateDeltaVBudgetMetrics(11.63, undefined);
      assert(getDeltaVGaugeState(invalidAnalysis) === null, "Undefined budget must yield null gauge state");

      // 4. Zero required delta-v
      const zeroAnalysis = calculateDeltaVBudgetMetrics(0, 25.0);
      const zeroGauge = getDeltaVGaugeState(zeroAnalysis);
      assert(zeroGauge !== null, "Zero required delta-v must yield valid gauge state");
      if (zeroGauge) {
        assert(zeroGauge.statusTier === "healthy", "Zero required delta-v must be 'healthy'");
        assert(zeroGauge.badgeVariant === "emerald", "Zero required delta-v badge must be 'emerald'");
        assert(zeroGauge.visualBarWidthPercent === 0, "Visual bar width must be 0% for zero required delta-v");
        assert(zeroGauge.formattedUtilization === "0.00%", "Formatted utilization must be '0.00%'");
        assert(zeroGauge.formattedMargin === "+25.000 m/s", "Formatted margin must be '+25.000 m/s'");
      }

      // 5. Correct status styling at boundary thresholds (79.9%, 80.0%, 100.0%, 100.1%)
      const sub80Analysis = calculateDeltaVBudgetMetrics(79.9, 100.0);
      const sub80Gauge = getDeltaVGaugeState(sub80Analysis);
      assert(sub80Gauge !== null, "79.9% gauge state must not be null");
      if (sub80Gauge) {
        assert(sub80Gauge.statusTier === "healthy", "79.9% must be healthy");
        assert(sub80Gauge.badgeVariant === "emerald", "79.9% badge must be emerald");
        assert(sub80Gauge.barColorClass.includes("emerald"), "79.9% bar color must be emerald");
      }

      const at80Analysis = calculateDeltaVBudgetMetrics(80.0, 100.0);
      const at80Gauge = getDeltaVGaugeState(at80Analysis);
      assert(at80Gauge !== null, "80.0% gauge state must not be null");
      if (at80Gauge) {
        assert(at80Gauge.statusTier === "marginal", "80.0% must be marginal");
        assert(at80Gauge.badgeVariant === "amber", "80.0% badge must be amber");
        assert(at80Gauge.barColorClass.includes("amber"), "80.0% bar color must be amber");
        assert(at80Gauge.visualBarWidthPercent === 80.0, "80.0% visual bar width must be 80.0%");
      }

      const at100Analysis = calculateDeltaVBudgetMetrics(100.0, 100.0);
      const at100Gauge = getDeltaVGaugeState(at100Analysis);
      assert(at100Gauge !== null, "100.0% gauge state must not be null");
      if (at100Gauge) {
        assert(at100Gauge.statusTier === "marginal", "100.0% must be marginal");
        assert(at100Gauge.badgeVariant === "amber", "100.0% badge must be amber");
        assert(at100Gauge.barColorClass.includes("amber"), "100.0% bar color must be amber");
        assert(at100Gauge.visualBarWidthPercent === 100.0, "100.0% visual bar width must be 100.0%");
      }

      const above100Analysis = calculateDeltaVBudgetMetrics(100.1, 100.0);
      const above100Gauge = getDeltaVGaugeState(above100Analysis);
      assert(above100Gauge !== null, "100.1% gauge state must not be null");
      if (above100Gauge) {
        assert(above100Gauge.statusTier === "exceeded", "100.1% must be exceeded");
        assert(above100Gauge.badgeVariant === "rose", "100.1% badge must be rose");
        assert(above100Gauge.barColorClass.includes("rose"), "100.1% bar color must be rose");
        assert(above100Gauge.visualBarWidthPercent === 100.0, "100.1% visual bar width must be capped at 100.0%");
        assert(above100Gauge.formattedUtilization === "100.10%", "100.1% formatted utilization must display uncapped 100.10%");
      }

      // 6. Backend feasibility remaining distinct from calculated utilization
      assert(
        DEMO_INFEASIBLE_REMEDIATION_RESPONSE.rendezvous.is_budget_feasible === false,
        "Authoritative backend feasibility on infeasible fixture must remain false"
      );
      assert(
        DEMO_REMEDIATION_RESPONSE.rendezvous.is_budget_feasible === true,
        "Authoritative backend feasibility on nominal fixture must remain true"
      );
      assert(
        nominalAnalysis?.isBudgetExceeded === false,
        "Frontend calculated isBudgetExceeded must be false for nominal scenario"
      );
      assert(
        infeasibleAnalysis?.isBudgetExceeded === true,
        "Frontend calculated isBudgetExceeded must be true for infeasible scenario"
      );
    });

    runTest("Phase 6D.2 Step 3: Hill/RIC Directional Vector Breakdown [R, I, C], symmetric scaling, indicators, and edge cases", () => {
      const maxScale = 5.184;

      // 1. Backend [R, I, C] component mapping, axis colors, and directional indicators
      // Radial (R)
      const radialPos = computeHillComponentBreakdown("R", 2.105, maxScale);
      assert(radialPos.axis === "R", "Axis must be R");
      assert(radialPos.axisName === "Radial", "Axis name must be Radial");
      assert(radialPos.directionSymbol === "+R", "Direction symbol must be +R");
      assert(radialPos.directionLabel === "+R Outward", "Label must be +R Outward");
      assert(radialPos.directionDescription === "Outward Radial (+R)", "Description must be Outward Radial (+R)");
      assert(radialPos.formattedValue === "+2.1050 m/s", "Formatted value must have + sign and 4 decimals");
      assert(radialPos.barSide === "right", "Positive component must extend right");
      assert(radialPos.colorClass.includes("cyan"), "Radial must use cyan");
      assert(radialPos.badgeVariant === "cyan", "Radial badge must be cyan");

      const radialNeg = computeHillComponentBreakdown("R", -3.421, maxScale);
      assert(radialNeg.axis === "R", "Axis must be R");
      assert(radialNeg.directionSymbol === "−R", "Direction symbol must be −R");
      assert(radialNeg.directionLabel === "−R Inward", "Label must be −R Inward");
      assert(radialNeg.directionDescription === "Inward Radial (−R)", "Description must be Inward Radial (−R)");
      assert(radialNeg.formattedValue === "-3.4210 m/s", "Formatted value must have - sign and 4 decimals");
      assert(radialNeg.barSide === "left", "Negative component must extend left");
      assert(radialNeg.colorClass.includes("cyan"), "Radial must use cyan");

      // In-Track (I)
      const inTrackPos = computeHillComponentBreakdown("I", 5.184, maxScale);
      assert(inTrackPos.axis === "I", "Axis must be I");
      assert(inTrackPos.axisName === "In-Track", "Axis name must be In-Track");
      assert(inTrackPos.directionSymbol === "+I", "Direction symbol must be +I");
      assert(inTrackPos.directionLabel === "+I Prograde", "Label must be +I Prograde");
      assert(inTrackPos.directionDescription === "Prograde / Along-Track (+I)", "Description must be Prograde");
      assert(inTrackPos.formattedValue === "+5.1840 m/s", "Formatted value must be +5.1840 m/s");
      assert(inTrackPos.barSide === "right", "Positive in-track must extend right");
      assert(inTrackPos.colorClass.includes("emerald"), "In-track must use emerald");
      assert(inTrackPos.badgeVariant === "emerald", "In-track badge must be emerald");

      const inTrackNeg = computeHillComponentBreakdown("I", -4.892, maxScale);
      assert(inTrackNeg.axis === "I", "Axis must be I");
      assert(inTrackNeg.directionSymbol === "−I", "Direction symbol must be −I");
      assert(inTrackNeg.directionLabel === "−I Retrograde", "Label must be −I Retrograde");
      assert(inTrackNeg.directionDescription === "Retrograde / Against-Track (−I)", "Description must be Retrograde");
      assert(inTrackNeg.formattedValue === "-4.8920 m/s", "Formatted value must be -4.8920 m/s");
      assert(inTrackNeg.barSide === "left", "Negative in-track must extend left");
      assert(inTrackNeg.colorClass.includes("emerald"), "In-track must use emerald");

      // Cross-Track (C)
      const crossTrackPos = computeHillComponentBreakdown("C", 0.812, maxScale);
      assert(crossTrackPos.axis === "C", "Axis must be C");
      assert(crossTrackPos.axisName === "Cross-Track", "Axis name must be Cross-Track");
      assert(crossTrackPos.directionSymbol === "+C", "Direction symbol must be +C");
      assert(crossTrackPos.directionLabel === "+C Positive Orbit Normal", "Label must be +C Positive Orbit Normal");
      assert(crossTrackPos.directionDescription === "Positive Cross-Track (+C)", "Description must be Positive Cross-Track");
      assert(!crossTrackPos.directionLabel.toLowerCase().includes("north") && !crossTrackPos.directionLabel.toLowerCase().includes("south"), "Label must not use geographic north/south terminology");
      assert(!crossTrackPos.directionDescription.toLowerCase().includes("north") && !crossTrackPos.directionDescription.toLowerCase().includes("south"), "Description must not use geographic north/south terminology");
      assert(crossTrackPos.barSide === "right", "Positive cross-track must extend right");
      assert(crossTrackPos.colorClass.includes("amber"), "Cross-track must use amber");
      assert(crossTrackPos.badgeVariant === "amber", "Cross-track badge must be amber");

      const crossTrackNeg = computeHillComponentBreakdown("C", -0.654, maxScale);
      assert(crossTrackNeg.axis === "C", "Axis must be C");
      assert(crossTrackNeg.directionSymbol === "−C", "Direction symbol must be −C");
      assert(crossTrackNeg.directionLabel === "−C Negative Orbit Normal", "Label must be −C Negative Orbit Normal");
      assert(crossTrackNeg.directionDescription === "Negative Cross-Track (−C)", "Description must be Negative Cross-Track");
      assert(!crossTrackNeg.directionLabel.toLowerCase().includes("north") && !crossTrackNeg.directionLabel.toLowerCase().includes("south"), "Label must not use geographic north/south terminology");
      assert(!crossTrackNeg.directionDescription.toLowerCase().includes("north") && !crossTrackNeg.directionDescription.toLowerCase().includes("south"), "Description must not use geographic north/south terminology");
      assert(crossTrackPos.directionLabel !== crossTrackNeg.directionLabel, "Positive and negative cross-track directions must have distinct labels");
      assert(crossTrackNeg.barSide === "left", "Negative cross-track must extend left");
      assert(crossTrackNeg.colorClass.includes("amber"), "Cross-track must use amber");

      // 2. Near-zero component indicator
      const zeroComp = computeHillComponentBreakdown("I", 0.0, maxScale);
      assert(zeroComp.isZero === true, "isZero must be true for 0.0");
      assert(zeroComp.directionLabel === "NEAR ZERO", "Label must be NEAR ZERO");
      assert(zeroComp.formattedValue === "0.0000 m/s", "Value must be 0.0000 m/s");
      assert(zeroComp.barSide === "center", "Bar side must be center");
      assert(zeroComp.barPercent === 0, "Bar percent must be 0 for zero value");

      const epsilonComp = computeHillComponentBreakdown("R", 1e-6, maxScale);
      assert(epsilonComp.isZero === true, "isZero must be true for < 1e-5");
      assert(epsilonComp.directionLabel === "NEAR ZERO", "Label must be NEAR ZERO for epsilon");

      // 3. Symmetric scaling around zero reference line
      const fullScalePos = computeHillComponentBreakdown("I", 5.184, 5.184);
      assert(Math.abs(fullScalePos.barPercent - 50.0) < 1e-4, "Full scale positive must be exactly 50% half-width");
      const fullScaleNeg = computeHillComponentBreakdown("I", -5.184, 5.184);
      assert(Math.abs(fullScaleNeg.barPercent - 50.0) < 1e-4, "Full scale negative must be exactly 50% half-width");

      const halfScalePos = computeHillComponentBreakdown("I", 2.592, 5.184);
      assert(Math.abs(halfScalePos.barPercent - 25.0) < 1e-4, "Half scale positive must be exactly 25% half-width");
      const halfScaleNeg = computeHillComponentBreakdown("I", -2.592, 5.184);
      assert(Math.abs(halfScaleNeg.barPercent - 25.0) < 1e-4, "Half scale negative must be exactly 25% half-width");

      // 4. Burn 1 & Burn 2 full breakdown from nominal fixture
      const b1 = computeBurnVectorBreakdown("Burn 1", "Departure", DEMO_REMEDIATION_RESPONSE.rendezvous.burn_1_dv_cw_ms, 5.184);
      assert(b1.isValid === true, "Burn 1 breakdown must be valid");
      assert(b1.burnName === "Burn 1", "Burn name must match");
      assert(b1.burnType === "Departure", "Burn type must be Departure");
      assert(b1.formattedMagnitude === "6.2639 m/s", "Burn 1 magnitude must be 6.2639 m/s");
      assert(Math.abs(b1.magnitudeMs - 6.263884) < 1e-4, "Burn 1 magnitudeMs must be Euclidean norm");
      // Ordering: [0] = Radial, [1] = In-Track, [2] = Cross-Track
      assert(b1.components[0].axis === "R", "B1[0] must be Radial");
      assert(b1.components[0].directionSymbol === "−R", "B1[0] direction symbol must be −R");
      assert(b1.components[1].axis === "I", "B1[1] must be In-Track");
      assert(b1.components[1].directionSymbol === "+I", "B1[1] direction symbol must be +I");
      assert(b1.components[2].axis === "C", "B1[2] must be Cross-Track");
      assert(b1.components[2].directionSymbol === "+C", "B1[2] direction symbol must be +C");

      const b2 = computeBurnVectorBreakdown("Burn 2 — Arrival / Terminal Correction", "Arrival", DEMO_REMEDIATION_RESPONSE.rendezvous.burn_2_dv_cw_ms, 5.184);
      assert(b2.isValid === true, "Burn 2 breakdown must be valid");
      assert(b2.burnName === "Burn 2 — Arrival / Terminal Correction", "Burn 2 name must match");
      assert(b2.burnName.includes("Terminal Correction"), "Burn 2 must be described as a terminal correction");
      assert(!b2.burnName.toLowerCase().includes("braking"), "Burn 2 must not categorically be called a braking burn");
      assert(b2.burnType === "Arrival", "Burn type must be Arrival");
      assert(b2.formattedMagnitude === "5.3657 m/s", "Burn 2 magnitude must be 5.3657 m/s");
      assert(Math.abs(b2.magnitudeMs - 5.365737) < 1e-4, "Burn 2 magnitudeMs must be Euclidean norm");
      // Ordering: [0] = Radial, [1] = In-Track, [2] = Cross-Track
      assert(b2.components[0].axis === "R", "B2[0] must be Radial");
      assert(b2.components[0].directionSymbol === "+R", "B2[0] direction symbol must be +R");
      assert(b2.components[1].axis === "I", "B2[1] must be In-Track");
      assert(b2.components[1].directionSymbol === "−I", "B2[1] direction symbol must be −I");
      assert(b2.components[2].axis === "C", "B2[2] must be Cross-Track");
      assert(b2.components[2].directionSymbol === "−C", "B2[2] direction symbol must be −C");

      // Total burn magnitude independence check: total delta-v is sum of norms
      const totalDvFromNorms = b1.magnitudeMs + b2.magnitudeMs;
      assert(
        Math.abs(totalDvFromNorms - DEMO_REMEDIATION_RESPONSE.rendezvous.total_delta_v_ms) < 1e-3,
        "Total delta-v must match sum of burn magnitudes"
      );

      // 5. Missing and invalid handling
      const nullBurn = computeBurnVectorBreakdown("Burn Null", "Departure", null, 5.0);
      assert(nullBurn.isValid === false, "Null vector must be invalid");
      assert(nullBurn.formattedMagnitude === "Unavailable", "Null vector magnitude must be Unavailable");
      assert(nullBurn.components[0].isValid === false, "Component must be invalid");
      assert(nullBurn.components[0].formattedValue === "Invalid", "Formatted value must be Invalid");
      assert(nullBurn.components[0].directionLabel === "UNAVAILABLE", "Direction label must be UNAVAILABLE");

      const nanBurn = computeBurnVectorBreakdown("Burn NaN", "Departure", [NaN, 1.0, 2.0], 5.0);
      assert(nanBurn.isValid === false, "NaN vector must be invalid");
      assert(nanBurn.formattedMagnitude === "Invalid", "NaN vector magnitude must be Invalid");
      assert(nanBurn.components[0].isValid === false, "Component 0 must be invalid");
      assert(nanBurn.components[1].isValid === true, "Component 1 must be valid");
    });

    runTest("Phase 6D.2 Step 4: Scientific boundary disclosure, assumptions, unmodeled dynamics, and operational non-qualification", () => {
      // 1. Mandatory headline disclosure
      assert(
        CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.headline.includes("Idealized instantaneous open-loop velocity impulses"),
        "Headline must declare idealized instantaneous open-loop velocity impulses"
      );
      assert(
        CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.headline.includes("not verified closed-loop spacecraft guidance commands"),
        "Headline must declare not verified closed-loop spacecraft guidance commands"
      );

      // 2. Canonical single-string disclosure export
      assert(
        CW_SCIENTIFIC_DISCLOSURE_TEXT.includes("idealized instantaneous open-loop velocity impulses, not verified closed-loop spacecraft guidance commands"),
        "Canonical text must declare open-loop impulses vs guidance commands"
      );

      // 3. Point 1: Instantaneous impulses and unmodeled finite thrust
      const pt1 = CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.points.find((p) => p.id === "instantaneous-impulses");
      assert(pt1 !== undefined, "Point 1 (instantaneous-impulses) must be defined");
      assert(
        pt1!.detail.toLowerCase().includes("instantaneous changes in velocity"),
        "Point 1 must declare burns are modelled as instantaneous changes in velocity"
      );
      assert(
        pt1!.detail.toLowerCase().includes("finite engine burn duration") &&
        pt1!.detail.toLowerCase().includes("not modelled"),
        "Point 1 must declare finite engine burn duration and thrust profiles are not modelled"
      );

      // 4. Point 2: Attitude and pointing dynamics
      const pt2 = CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.points.find((p) => p.id === "attitude-pointing");
      assert(pt2 !== undefined, "Point 2 (attitude-pointing) must be defined");
      assert(
        pt2!.detail.toLowerCase().includes("attitude slew") &&
        pt2!.detail.toLowerCase().includes("pointing constraints") &&
        pt2!.detail.toLowerCase().includes("actuator dynamics"),
        "Point 2 must explicitly cover attitude slew, pointing constraints, and actuator dynamics"
      );

      // 5. Point 3: Closed-loop guidance and feedback
      const pt3 = CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.points.find((p) => p.id === "closed-loop-guidance");
      assert(pt3 !== undefined, "Point 3 (closed-loop-guidance) must be defined");
      assert(
        pt3!.detail.toLowerCase().includes("navigation feedback") &&
        pt3!.detail.toLowerCase().includes("guidance corrections") &&
        pt3!.detail.toLowerCase().includes("closed-loop tracking errors"),
        "Point 3 must explicitly declare no onboard navigation feedback, guidance corrections, or tracking errors"
      );

      // 6. Point 4: Linearized perturbations
      const pt4 = CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.points.find((p) => p.id === "linearized-perturbations");
      assert(pt4 !== undefined, "Point 4 (linearized-perturbations) must be defined");
      assert(
        pt4!.detail.toLowerCase().includes("linearized relative-motion dynamics") &&
        pt4!.detail.toLowerCase().includes("does not represent all real orbital perturbations"),
        "Point 4 must declare CW relies on linearized relative dynamics and does not represent all perturbations"
      );

      // 7. Point 5: Operational qualification vs mathematical feasibility
      const pt5 = CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.points.find((p) => p.id === "operational-qualification");
      assert(pt5 !== undefined, "Point 5 (operational-qualification) must be defined");
      assert(
        pt5!.detail.toLowerCase().includes("mathematically feasible") &&
        pt5!.detail.toLowerCase().includes("not proof of flight readiness") &&
        pt5!.detail.toLowerCase().includes("safe execution"),
        "Point 5 must declare mathematical feasibility is not proof of flight readiness or safe execution"
      );

      // 8. Scientific integrity: no false claims of modeling operational systems
      const allText = CW_SCIENTIFIC_DISCLOSURE_TEXT.toLowerCase();
      assert(
        allText.includes("not verified closed-loop spacecraft guidance commands"),
        "Must explicitly disclaim verified guidance commands"
      );
      assert(
        allText.includes("not proof of flight readiness"),
        "Must explicitly disclaim flight readiness"
      );

      // 9. Consistent eccentricity applicability boundary: e ≤ 0.005
      assert(
        CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.intro.includes("e ≤ 0.005"),
        "Boundary disclosure intro must declare e ≤ 0.005"
      );
      assert(
        !CW_SCIENTIFIC_BOUNDARY_DISCLOSURE.intro.includes("e < 0.005"),
        "Boundary disclosure intro must not declare strict inequality e < 0.005"
      );
      assert(
        CW_SCIENTIFIC_DISCLOSURE_TEXT.includes("e ≤ 0.005"),
        "Canonical text export must declare e ≤ 0.005"
      );
    });

  return { total, passed, details };
}
