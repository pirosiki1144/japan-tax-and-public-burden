import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("Issue 87 migration preserves all burdens, phases, and import candidates", async () => {
  const [master, initialImport, review] = await Promise.all([
    json("../data/master/canonical.json"),
    json("../data/master/initial-import.json"),
    json("../data/monitoring/review.json")
  ]);
  assert.equal(master.public_burdens.length, 112);
  assert.equal(master.burden_components.length, 2);
  assert.deepEqual(master.migration_audit, {
    issue: 87,
    source_burden_count: 112,
    source_phase_count: 2,
    preserved_public_burden_count: 112,
    created_component_count: 2
  });
  assert.equal(initialImport.burdens.length, 112);
  assert.equal(initialImport.candidates.length, 119);
  assert.equal(initialImport.candidates.filter(({ disposition }) => disposition === "merged").length, 1);
  assert.equal(initialImport.candidates.filter(({ disposition }) => disposition === "pending").length, 118);
  assert.ok(review.baseline.records.length > 0);
});

test("consumption tax split retains the two source-backed national rates", async () => {
  const master = await json("../data/master/canonical.json");
  const values = master.burden_components
    .filter(({ public_burden_id }) => public_burden_id === "consumption-tax")
    .map(({ component_id, versions }) => [component_id, versions[0].value.numeric_value]);
  assert.deepEqual(values, [
    ["consumption-tax-standard-rate-2019", 7.8],
    ["consumption-tax-reduced-rate-2019", 6.24]
  ]);
});
