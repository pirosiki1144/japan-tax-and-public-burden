import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDecisionViews, loadMonitoringRegistry } from "../scripts/composition/monitoring-registry.js";
import { createValidators, validateDocument } from "../scripts/adapters/schema-validator.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const names = ["national-tax-adapters", "local-tax-adapters", "social-insurance-adapters", "public-burden-adapters"];

async function inputs() {
  const views = buildDecisionViews(await loadMonitoringRegistry(root));
  const validators = await createValidators(Object.fromEntries(names.map((name) => [name, join(root, `schemas/${name}.schema.json`)])));
  return { views, validators };
}

test("shared schema references preserve valid category views", async () => {
  const { views, validators } = await inputs();
  for (const name of names) assert.deepEqual(validateDocument(validators[name], views[name], name), []);
});

test("shared ID and verification-time constraints remain fail-closed", async () => {
  const { views, validators } = await inputs();
  for (const name of names) {
    const invalidTime = structuredClone(views[name]);
    invalidTime.verified_at = "not-a-time";
    assert.ok(validateDocument(validators[name], invalidTime, name).some((error) => /format/.test(error)));
  }
  const invalidId = structuredClone(views["national-tax-adapters"]);
  invalidId.targets[0].tax_id = "Invalid ID";
  assert.ok(validateDocument(validators["national-tax-adapters"], invalidId, "national").some((error) => /pattern/.test(error)));
});

test("category-specific counts and conditional fields are not weakened", async () => {
  const { views, validators } = await inputs();
  const national = structuredClone(views["national-tax-adapters"]);
  national.targets.pop();
  assert.ok(validateDocument(validators["national-tax-adapters"], national, "national").some((error) => /fewer than 23/.test(error)));

  const local = structuredClone(views["local-tax-adapters"]);
  delete local.targets.find(({ status }) => status === "implemented").articles;
  assert.ok(validateDocument(validators["local-tax-adapters"], local, "local").some((error) => /required property/.test(error)));

  const social = structuredClone(views["social-insurance-adapters"]);
  social.targets.find(({ status }) => status === "held").hold_reason = "short";
  assert.ok(validateDocument(validators["social-insurance-adapters"], social, "social").some((error) => /fewer than 20/.test(error)));
});

test("production configuration never treats test fixtures as canonical input", async () => {
  for (const name of ["sources.yaml", "monitoring.yaml", "distribution.yaml"]) {
    assert.doesNotMatch(await readFile(join(root, "config", name), "utf8"), /tests\/fixtures/);
  }
});
