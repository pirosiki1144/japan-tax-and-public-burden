import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateIntegrity } from "../scripts/validate/integrity-validator.js";
import { validatePersistedFileCoverage } from "../scripts/validate/repository-validator.js";

test("every persisted data and config file has an explicit schema route", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const validated = new Set([
    join(root, "config/distribution.yaml"),
    join(root, "config/initial-master-selection.yaml"), join(root, "config/monitoring.yaml"),
    join(root, "config/sources.yaml"), join(root, "data/monitoring/semantic-baseline.json"),
    join(root, "data/reconciliation/national-burden-ratio-mapping.yaml"),
    join(root, "data/reconciliation/national-burden-ratio.csv"), join(root, "data/revenue/actuals.csv")
  ]);
  for (const path of ["data/burdens/consumption-tax.yaml", "data/burdens/initial-master.json", "data/candidates/local-taxes.yaml", "data/candidates/national-taxes.yaml", "data/candidates/public-burdens-government-additions.yaml", "data/candidates/public-burdens-question-39.yaml", "data/changes/consumption-tax-2019-rate.yaml", "data/events/consumption-tax-2019-application-started.yaml", "data/phases/consumption-tax.yaml"]) validated.add(join(root, path));
  assert.deepEqual(await validatePersistedFileCoverage(root, validated), []);
});

test("an unregistered persisted file cannot bypass schema validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "repository-consistency-"));
  for (const path of ["config", "data/burdens", "data/candidates", "data/changes", "data/events", "data/phases", "data/monitoring", "data/reconciliation", "data/revenue"]) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, "data/burdens/unmapped.csv"), "tax_id\nexample\n");
  const errors = await validatePersistedFileCoverage(root, new Set());
  assert.ok(errors.includes("data/burdens/unmapped.csv: no repository schema validation route"));
});

test("source and semantic baseline tax IDs must reference canonical burdens", () => {
  const errors = validateIntegrity({
    burdens: [], candidates: [], changes: [], events: [], phases: [], revenues: [], mappings: [],
    sources: [{ source_id: "sample-source", monitoring_tax_ids: ["missing-tax"] }],
    semanticBaselines: [{ records: [{ tax_id: "missing-baseline-tax" }] }]
  });
  assert.ok(errors.includes("sample-source.monitoring_tax_ids: unknown reference missing-tax"));
  assert.ok(errors.includes("missing-baseline-tax.semantic_baseline.tax_id: unknown reference missing-baseline-tax"));
});
