import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildArchitectureInventory, classifyFile, forbiddenDependencies } from "../scripts/audit/architecture-inventory.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every tracked file has an explicit architectural responsibility", async () => {
  const report = await buildArchitectureInventory(root);
  assert.equal(report.files.some(({ responsibility }) => responsibility === "unclassified"), false);
  assert.equal(report.files.length, report.totals.tracked_files);
});

test("forbidden application and adapter dependency directions are detected", () => {
  assert.deepEqual(forbiddenDependencies({
    "scripts/application/use-case.js": ["scripts/adapters/filesystem-store.js"],
    "scripts/adapters/output.js": ["scripts/pipeline/run.js"]
  }), [
    "scripts/adapters/output.js -> scripts/pipeline/run.js",
    "scripts/application/use-case.js -> scripts/adapters/filesystem-store.js"
  ]);
});

test("the baseline inventory detects dependency and configuration duplication", async () => {
  const report = await buildArchitectureInventory(root);
  assert.deepEqual(report.import_graph.cycles, []);
  assert.deepEqual(report.import_graph.forbidden_edges, []);
  assert.equal(report.configuration_overlap.canonical_registry_targets, 112);
  assert.equal(report.configuration_overlap.post_initial_decision_targets, 110);
  assert.deepEqual(report.configuration_overlap.initial_implementation_targets, ["automobile-tax", "consumption-tax"]);
  assert.equal(report.configuration_overlap.manually_edited_decision_files, 1);
  assert.equal(report.io_duplication.atomic_write_implementations, 1);
  assert.deepEqual(report.io_duplication.atomic_writers, ["scripts/adapters/filesystem-store.js"]);
});

test("classification keeps canonical configuration separate from generated projections", () => {
  assert.equal(classifyFile("config/sources.yaml"), "source_of_truth");
  assert.equal(classifyFile("config/monitoring.yaml"), "source_of_truth");
  assert.equal(classifyFile("tests/fixtures/source-scan/example.html"), "fixture");
  assert.equal(classifyFile("scripts/pipeline/monitoring-pipeline.js"), "application");
  assert.equal(classifyFile("scripts/application/source-monitoring.js"), "application");
  assert.equal(classifyFile("scripts/composition/monitoring-composition.js"), "composition_root");
});
