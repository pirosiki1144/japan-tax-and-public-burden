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
    join(root, "config/monitoring.yaml"), join(root, "config/sources.yaml"),
    join(root, "config/architecture-responsibilities.json"), join(root, "config/architecture-violations-baseline.json"),
    join(root, "data/master/canonical.json"), join(root, "data/master/initial-import.json"),
    join(root, "data/monitoring/review.json")
  ]);
  assert.deepEqual(await validatePersistedFileCoverage(root, validated), []);
});

test("an unregistered persisted file cannot bypass schema validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "repository-consistency-"));
  for (const path of ["config", "data/master", "data/monitoring"]) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, "data/master/unmapped.csv"), "tax_id\nexample\n");
  const errors = await validatePersistedFileCoverage(root, new Set());
  assert.ok(errors.includes("data/master/unmapped.csv: no repository schema validation route"));
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
