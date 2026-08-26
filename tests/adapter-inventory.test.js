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
  assert.ok(inventory.targets.flatMap(({ sources }) => sources).filter(({ official_format }) => ["html", "pdf", "csv"].includes(official_format)).every(({ adapter_status }) => adapter_status === "implemented"));
});

test("every Issue 42 national tax is implemented or has a concrete hold reason", async () => {
  const { inventory } = await inputs();
  const national = inventory.targets.filter(({ implementation_issue }) => implementation_issue === 42);
  assert.equal(national.length, 23);
  assert.ok(national.every(({ implementation_status }) => ["implemented", "held"].includes(implementation_status)));
  assert.ok(national.filter(({ implementation_status }) => implementation_status === "held").every(({ sources }) => sources.every(({ hold_reason }) => hold_reason?.length >= 20)));
  assert.ok(national.filter(({ implementation_status }) => implementation_status === "implemented").every(({ capabilities }) => Object.values(capabilities).every((status) => status === "implemented")));
});

test("every Issue 43 local tax is implemented at national-law scope or held for a concrete reason", async () => {
  const { inventory } = await inputs();
  const local = inventory.targets.filter(({ implementation_issue }) => implementation_issue === 43);
  assert.equal(local.length, 22);
  assert.equal(local.filter(({ implementation_status }) => implementation_status === "implemented").length, 15);
  assert.equal(local.filter(({ implementation_status }) => implementation_status === "held").length, 7);
  assert.ok(local.filter(({ implementation_status }) => implementation_status === "held").every(({ sources }) => sources.every(({ hold_reason }) => hold_reason?.length >= 20)));
});

test("Issue 44 implements nationwide reviewable values and holds variable scopes", async () => {
  const { inventory } = await inputs();
  const social = inventory.targets.filter(({ implementation_issue }) => implementation_issue === 44);
  assert.equal(social.length, 5);
  assert.equal(social.filter(({ implementation_status }) => implementation_status === "implemented").length, 2);
  assert.equal(social.filter(({ implementation_status }) => implementation_status === "held").length, 3);
  assert.ok(social.filter(({ implementation_status }) => implementation_status === "held").every(({ sources }) => sources.every(({ hold_reason }) => hold_reason?.length >= 20)));
  assert.ok(social.filter(({ implementation_status }) => implementation_status === "implemented").every(({ sources }) => sources.some(({ adapter_status }) => adapter_status === "implemented")));
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

test("implemented assignments and manual reasons cannot silently disappear", async () => {
  const { inventory, monitoring } = await inputs();
  const implemented = structuredClone(inventory);
  const implementedTarget = implemented.targets.find(({ implementation_status }) => implementation_status === "implemented");
  implementedTarget.sources.forEach((source) => { source.adapter_status = "held"; source.hold_reason = "根拠付きmanualへ移行するための一時的な確認理由を記録する"; });
  assert.ok(validateInventoryCoverage(implemented, monitoring).some((error) => /implemented target has no implemented source/.test(error)));

  const manual = structuredClone(inventory);
  const manualTarget = manual.targets.find(({ implementation_status }) => implementation_status === "held");
  delete manualTarget.sources.find(({ adapter_status }) => adapter_status === "held").hold_reason;
  assert.ok(validateInventoryCoverage(manual, monitoring).some((error) => /manual reason is missing/.test(error)));
});
