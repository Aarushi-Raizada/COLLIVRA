import path from "path";
import Module from "module";

// Resolve Next.js "@/..." path aliases to "./src/..." during test execution under sucrase-node
const originalResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any
) {
  if (request.startsWith("@/")) {
    request = path.join(__dirname, "src", request.slice(2));
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

import { runCoordinateTests } from "./src/lib/__tests__/coordinates.test";
import { runValidationTests } from "./src/lib/__tests__/validation.test";
import { runConjunctionScreeningTests } from "./src/lib/__tests__/conjunction_screening.test";
import { runApiReliabilityTests } from "./src/lib/__tests__/api_reliability.test";
import { runRiskProvenanceTests } from "./src/lib/__tests__/risk_provenance.test";
import { runSimulationApiTests } from "./src/lib/__tests__/simulation_api.test";
import { runSimulationDashboardTests } from "./src/lib/__tests__/simulation_dashboard.test";
import { runMissionDashboardTests } from "./src/lib/__tests__/mission_dashboard.test";
import { runOrbitalRadarTests } from "./src/lib/__tests__/orbital_radar.test";
import { runCollisionIntelligenceTests } from "./src/lib/__tests__/collision_intelligence_view.test";
import { runSimulationRemediationViewTests } from "./src/lib/__tests__/simulation_remediation_view.test";
import { runSystemIntegrationTests } from "./src/lib/__tests__/system_integration.test";
import { runUrnTests } from "./src/lib/__tests__/urn_resolution.test";
import { runSharedStoreTests } from "./src/lib/__tests__/shared_store.test";
import { runNavigationSyncTests } from "./src/lib/__tests__/navigation_sync.test";
import { runSimulationPayloadRegistryTests } from "./src/lib/__tests__/simulation_payload_registry.test";
import { runSimulationShellIntegrationTests } from "./src/lib/__tests__/simulation_shell_integration.test";
import { runSimulationRegistryResolutionTests } from "./src/lib/__tests__/simulation_registry_resolution.test";
import { runSimulationIntegrationTests } from "./src/lib/__tests__/simulation_integration.test";
import { runCollivraShellTests } from "./src/lib/__tests__/collivra_shell.test";
import { runCollivraRadarElevationTests } from "./src/lib/__tests__/collivra_radar_elevation.test";
import { runCollivraCollisionDebrisTests } from "./src/lib/__tests__/collivra_collision_debris.test";
import { runCollivraRemediationIntegrityTests } from "./src/lib/__tests__/collivra_remediation_integrity.test";
import { runCollivraC5ProductIntegrationTests } from "./src/lib/__tests__/collivra_c5_product_integration.test";

async function main() {
  console.log("=== Running ZORBIT Frontend Astrodynamics Tests ===");
  const coordResults = runCoordinateTests();
  coordResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${coordResults.passed}/${coordResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Runtime Validation & Contract Enforcement Tests ===");
  const valResults = runValidationTests();
  valResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${valResults.passed}/${valResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Conjunction Screening Query & Summary Tests ===");
  const screeningResults = runConjunctionScreeningTests();
  screeningResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${screeningResults.passed}/${screeningResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Connection & Screening Reliability Tests ===");
  const reliabilityResults = runApiReliabilityTests();
  reliabilityResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${reliabilityResults.passed}/${reliabilityResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Risk Assessment & Synthetic Provenance Tests ===");
  const riskResults = runRiskProvenanceTests();
  riskResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${riskResults.passed}/${riskResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Simulation & Remediation API Tests ===");
  const simResults = await runSimulationApiTests();
  simResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${simResults.passed}/${simResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Simulation & Remediation Dashboard UI Tests ===");
  const simDashResults = runSimulationDashboardTests();
  simDashResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${simDashResults.passed}/${simDashResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Mission Dashboard UI & Astrodynamics Tests ===");
  const missionDashResults = runMissionDashboardTests();
  missionDashResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${missionDashResults.passed}/${missionDashResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT 3D Orbital Radar & Inspector HUD Tests ===");
  const radarResults = runOrbitalRadarTests();
  radarResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${radarResults.passed}/${radarResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Collision Intelligence & Encounter Geometry Tests ===");
  const collisionResults = runCollisionIntelligenceTests();
  collisionResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${collisionResults.passed}/${collisionResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Simulation & Remediation Scientific & View Tests ===");
  const simRemViewResults = runSimulationRemediationViewTests();
  simRemViewResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${simRemViewResults.passed}/${simRemViewResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT Phase 6 System Integration & Cross-Module Tests ===");
  const integrationResults = runSystemIntegrationTests();
  integrationResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${integrationResults.passed}/${integrationResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT M6.3.1 Canonical URN & Identity Tests ===");
  const urnResults = runUrnTests();
  urnResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${urnResults.passed}/${urnResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT M6.3.1 Shared Domain Store Tests ===");
  const storeResults = runSharedStoreTests();
  storeResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${storeResults.passed}/${storeResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT M6.3.2 URL Synchronization & History Tests ===");
  const navSyncResults = runNavigationSyncTests();
  navSyncResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${navSyncResults.passed}/${navSyncResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT M6.3.4 Stage 1 Simulation Payload Registry & Adapter Tests ===");
  const registryResults = runSimulationPayloadRegistryTests();
  registryResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${registryResults.passed}/${registryResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT M6.3.4 Stage 2 Store & Shell Parameter Propagation Tests ===");
  const shellResults = runSimulationShellIntegrationTests();
  shellResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${shellResults.passed}/${shellResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT M6.3.4 Stage 3 Dashboard Registry Resolution Tests ===");
  const resolutionResults = runSimulationRegistryResolutionTests();
  resolutionResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${resolutionResults.passed}/${resolutionResults.total} tests successfully!\n`);

  console.log("=== Running ZORBIT M6.3.4 Stage 4 Simulation Integration Tests ===");
  const stage4IntegrationResults = runSimulationIntegrationTests();
  stage4IntegrationResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${stage4IntegrationResults.passed}/${stage4IntegrationResults.total} tests successfully!\n`);

  console.log("=== Running COLLIVRA AST-01C.1 Design System & Shell Tests ===");
  const shellBrandingResults = runCollivraShellTests();
  shellBrandingResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${shellBrandingResults.passed}/${shellBrandingResults.total} tests successfully!\n`);

  console.log("=== Running COLLIVRA AST-01C.2 Mission Overview & Radar Elevation Tests ===");
  const radarElevationResults = runCollivraRadarElevationTests();
  radarElevationResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${radarElevationResults.passed}/${radarElevationResults.total} tests successfully!\n`);

  console.log("=== Running COLLIVRA AST-01C.3 Collision Intelligence & Debris Evolution Tests ===");
  const collisionDebrisResults = runCollivraCollisionDebrisTests();
  collisionDebrisResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${collisionDebrisResults.passed}/${collisionDebrisResults.total} tests successfully!\n`);

  console.log("=== Running COLLIVRA AST-01C.4 Mitigation & Earth-Orientation Integrity Tests ===");
  const remediationIntegrityResults = runCollivraRemediationIntegrityTests();
  remediationIntegrityResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${remediationIntegrityResults.passed}/${remediationIntegrityResults.total} tests successfully!\n`);

  console.log("=== Running COLLIVRA AST-01C.5 Product Integration & Scenario Readiness Tests ===");
  const c5ProductIntegrationResults = runCollivraC5ProductIntegrationTests();
  c5ProductIntegrationResults.details.forEach(d => console.log(d));
  console.log(`Passed: ${c5ProductIntegrationResults.passed}/${c5ProductIntegrationResults.total} tests successfully!\n`);

  const totalPassed =
    coordResults.passed +
    valResults.passed +
    screeningResults.passed +
    reliabilityResults.passed +
    riskResults.passed +
    simResults.passed +
    simDashResults.passed +
    missionDashResults.passed +
    radarResults.passed +
    collisionResults.passed +
    simRemViewResults.passed +
    integrationResults.passed +
    urnResults.passed +
    storeResults.passed +
    navSyncResults.passed +
    registryResults.passed +
    shellResults.passed +
    resolutionResults.passed +
    stage4IntegrationResults.passed +
    shellBrandingResults.passed +
    radarElevationResults.passed +
    collisionDebrisResults.passed +
    remediationIntegrityResults.passed +
    c5ProductIntegrationResults.passed;
  const totalTests =
    coordResults.total +
    valResults.total +
    screeningResults.total +
    reliabilityResults.total +
    riskResults.total +
    simResults.total +
    simDashResults.total +
    missionDashResults.total +
    radarResults.total +
    collisionResults.total +
    simRemViewResults.total +
    integrationResults.total +
    urnResults.total +
    storeResults.total +
    navSyncResults.total +
    registryResults.total +
    shellResults.total +
    resolutionResults.total +
    stage4IntegrationResults.total +
    shellBrandingResults.total +
    radarElevationResults.total +
    collisionDebrisResults.total +
    remediationIntegrityResults.total +
    c5ProductIntegrationResults.total;
  console.log(`=== Total Test Results: ${totalPassed}/${totalTests} Passed ===`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});





