import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildArchitectureInventory, classifyFile } from "../scripts/audit/architecture-inventory.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every tracked file has an explicit architectural responsibility", async () => {
  const report = await buildArchitectureInventory(root);
  assert.equal(report.files.some(({ responsibility }) => responsibility === "unclassified"), false);
  assert.equal(report.files.length, report.totals.tracked_files);
});

test("the baseline inventory detects dependency and configuration duplication", async () => {
  const report = await buildArchitectureInventory(root);
  assert.deepEqual(report.import_graph.cycles, []);
  assert.equal(report.configuration_overlap.monitoring_targets, 112);
  assert.equal(report.configuration_overlap.inventory_targets, 112);
  assert.equal(report.configuration_overlap.canonical_manifest_targets, 112);
  assert.equal(report.configuration_overlap.post_initial_decision_targets, 110);
  assert.equal(report.configuration_overlap.tax_ids_repeated_in_canonical_and_two_derived_layers, 112);
  assert.deepEqual(report.configuration_overlap.initial_implementation_targets, ["automobile-tax", "consumption-tax"]);
  assert.equal(report.configuration_overlap.manually_edited_decision_files, 1);
  assert.ok(report.io_duplication.atomic_write_implementations > 1);
});

test("classification keeps canonical configuration separate from generated projections", () => {
  assert.equal(classifyFile("config/sources.yaml"), "source_of_truth");
  assert.equal(classifyFile("config/monitoring.yaml"), "derived_artifact");
  assert.equal(classifyFile("tests/fixtures/source-scan/example.html"), "fixture");
  assert.equal(classifyFile("scripts/pipeline/monitoring-pipeline.js"), "application");
});
