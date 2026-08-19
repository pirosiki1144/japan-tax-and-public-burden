import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildAdapterInventory, validateInventoryCoverage } from "../scripts/monitoring/build-adapter-inventory.js";
import { readYaml } from "../scripts/validate/schema-validator.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function inputs() {
  return {
    inventory: await buildAdapterInventory(root),
    monitoring: await readYaml(new URL("../config/monitoring.yaml", import.meta.url))
  };
}

test("every enabled monitoring target has one deterministic adapter assignment", async () => {
  const { inventory, monitoring } = await inputs();
  const tracked = JSON.parse(await readFile(new URL("../config/adapter-inventory.yaml", import.meta.url), "utf8"));
  assert.deepEqual(tracked, inventory);
  assert.deepEqual(validateInventoryCoverage(inventory, monitoring), []);
  assert.equal(inventory.targets.length, 112);
  assert.equal(new Set(inventory.targets.map(({ tax_id }) => tax_id)).size, 112);
  assert.deepEqual(Object.fromEntries([39, 42, 43, 44, 45].map((issue) => [issue, inventory.targets.filter(({ implementation_issue }) => implementation_issue === issue).length])), {
    39: 2, 42: 23, 43: 22, 44: 5, 45: 60
  });
});

test("official formats, required adapters, priorities, and dependencies are explicit", async () => {
  const { inventory } = await inputs();
  assert.ok(inventory.targets.every(({ priority, capabilities, sources }) => priority && Object.values(capabilities).every(Boolean) && sources.every(({ official_format, required_adapter, reuse_key }) => official_format && required_adapter && reuse_key)));
  assert.ok(inventory.targets.filter(({ implementation_issue }) => implementation_issue !== 39).every(({ depends_on_issues }) => depends_on_issues.includes(31)));
  assert.ok(inventory.targets.flatMap(({ sources }) => sources).filter(({ official_format }) => official_format !== "egov_law_api_json").every(({ shared_format_issue }) => shared_format_issue === 46));
});

test("large batches are permitted only for one common official source", async () => {
  const { inventory, monitoring } = await inputs();
  const batches = new Map();
  for (const target of inventory.targets) {
    if (!batches.has(target.batch_id)) batches.set(target.batch_id, []);
    batches.get(target.batch_id).push(target);
  }
  const large = [...batches.values()].filter((targets) => targets.length > 20);
  assert.equal(large.length, 1);
  assert.equal(new Set(large[0].map(({ reuse_group }) => reuse_group)).size, 1);

  const invalid = structuredClone(inventory);
  invalid.targets.slice(0, 21).forEach((target) => { target.batch_id = "issue-45-invalid-batch"; });
  assert.ok(validateInventoryCoverage(invalid, monitoring).some((error) => /exceed the batch limit/.test(error)));
});

test("missing, duplicate, and municipal-scope mistakes fail coverage validation", async () => {
  const { inventory, monitoring } = await inputs();
  const missing = structuredClone(inventory);
  missing.targets.pop();
  assert.ok(validateInventoryCoverage(missing, monitoring).some((error) => /unassigned targets/.test(error)));

  const duplicate = structuredClone(inventory);
  duplicate.targets.push(structuredClone(duplicate.targets[0]));
  assert.ok(validateInventoryCoverage(duplicate, monitoring).some((error) => /duplicate tax_id/.test(error)));

  const municipality = structuredClone(inventory);
  municipality.targets.find(({ burden_type }) => burden_type === "local_tax").municipal_scope = "national_only";
  assert.ok(validateInventoryCoverage(municipality, monitoring).some((error) => /Issue #20/.test(error)));
});
