import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildArchitectureInventory } from "../scripts/audit/architecture-inventory.js";
import { auditAdapterCoverage } from "../scripts/audit/adapter-coverage-audit.js";
import { loadMonitoringRegistry } from "../scripts/monitoring/monitoring-registry.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("obsolete persisted monitoring paths and compatibility facade are absent", async () => {
  for (const path of [
    "config/adapter-inventory.yaml", "config/monitoring-manifest.yaml", "config/format-adapters.yaml", "config/national-tax-adapters.yaml", "config/local-tax-adapters.yaml", "config/social-insurance-adapters.yaml", "config/public-burden-adapters.yaml", "scripts/pipeline/source-adapters.js"
  ]) await assert.rejects(access(`${root}/${path}`));
});

test("the architecture has one registry, one atomic writer, and no violations", async () => {
  const report = await buildArchitectureInventory(root);
  assert.equal(report.configuration_overlap.canonical_registry_targets, 112);
  assert.equal(report.configuration_overlap.manually_edited_decision_files, 1);
  assert.deepEqual(report.configuration_overlap.persisted_derived_target_files, []);
  assert.equal(report.io_duplication.atomic_write_implementations, 1);
  assert.deepEqual(report.import_graph.cycles, []);
  assert.deepEqual(report.import_graph.violations, []);
});

test("all 112 decisions, official evidence, manual audit metadata, and coverage remain reviewable", async () => {
  const [registry, coverage] = await Promise.all([loadMonitoringRegistry(root), auditAdapterCoverage(root)]);
  assert.equal(registry.targets.length, 112);
  assert.equal(registry.targets.filter(({ monitoring_mode }) => monitoring_mode === "automated").length, 10);
  assert.equal(registry.targets.filter(({ monitoring_mode }) => monitoring_mode === "manual").length, 102);
  const manualPublic = registry.targets.filter(({ decision_kind }) => decision_kind === "public_manual");
  assert.equal(manualPublic.length, 53);
  assert.ok(manualPublic.every(({ decision }) => decision.source_ids.length && decision.evidence_gap.length >= 20 && decision.release_conditions.length && decision.recheck_cadence));
  assert.equal(coverage.status, "clean");
  assert.equal(coverage.summary.total_targets, 112);
});

test("workflow and npm command compatibility remain unchanged", async () => {
  const workflows = (await readdir(`${root}/.github/workflows`)).filter((name) => name.endsWith(".yml")).sort();
  assert.deepEqual(workflows, ["source-scan.yml", "validate.yml"]);
  const packageJson = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  for (const name of ["test", "validate", "scan", "monitor", "generate", "monitoring:check", "monitoring:plan:check", "inventory:check", "audit:coverage"]) assert.equal(typeof packageJson.scripts[name], "string");
});
