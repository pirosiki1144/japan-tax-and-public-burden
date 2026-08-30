import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createValidators, validateDocument } from "../scripts/adapters/schema-validator.js";
import { buildDistributionRows, resolveDistributionOptions, serializeDistributionCsv, validateMasterIntegrity } from "../scripts/cli/public-burden-csv.js";

const root = new URL("..", import.meta.url).pathname;
const fixturePath = join(root, "tests/fixtures/public-burden-master/representative-cases.json");
const expectedPath = join(root, "tests/fixtures/public-burden-master/expected.csv");

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

test("atomic master schema keeps concepts independent from CSV columns", async () => {
  const master = await fixture();
  const { master: validate } = await createValidators({ master: join(root, "schemas/public-burden-master.schema.json") });
  assert.deepEqual(validateDocument(validate, master, fixturePath), []);
  assert.deepEqual(validateMasterIntegrity(master), []);
  assert.ok(master.source_facts.every((fact) => fact.value_raw && fact.legal_source_id));
  assert.ok(master.calculation_sets.every((set) => set.input_source_fact_ids.length > 0));
});

test("income brackets, consumption allocations, and pension shares use atomic rows", async () => {
  const rows = buildDistributionRows(await fixture(), "2026-08-30");
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.filter(({ public_burden_id }) => public_burden_id === "income-tax-example").map(({ numeric_value }) => numeric_value), [10, 5]);
  assert.equal(rows.filter(({ component_id }) => component_id === "consumption-local-component").length, 1);
  assert.equal(rows.find(({ component_id }) => component_id === "consumption-local-component").acquisition_type, "calculated");
  assert.equal(rows.find(({ component_id }) => component_id === "consumption-national-component").acquisition_type, "direct");
  assert.equal(rows.filter(({ version_id }) => version_id === "pension-insured-current").length, 2);
  assert.ok(rows.every(({ liable_party, payment_obligors }) => liable_party && payment_obligors));
});

test("as-of classification preserves past, current, and enacted future versions", async () => {
  const rows = buildDistributionRows(await fixture(), "2026-08-30");
  assert.deepEqual(new Set(rows.map(({ time_classification }) => time_classification)), new Set(["past", "current", "future"]));
});

test("multiple legal sources stay in one quoted multiline row", async () => {
  const rows = buildDistributionRows(await fixture(), "2026-08-30");
  const local = rows.find(({ component_id }) => component_id === "consumption-local-component");
  assert.match(local.law_evidence, /消費税法/);
  assert.match(local.law_evidence, /地方税法/);
  assert.equal(rows.filter(({ component_id }) => component_id === "consumption-local-component").length, 1);
  assert.match(serializeDistributionCsv([local]), /"[^\"]*\n[^\"]*"/);
});

test("distribution row IDs and CSV bytes are deterministic", async () => {
  const rows = buildDistributionRows(await fixture(), "2026-08-30");
  assert.equal(new Set(rows.map(({ distribution_row_id }) => distribution_row_id)).size, rows.length);
  const generated = serializeDistributionCsv(rows);
  assert.equal(generated, serializeDistributionCsv(buildDistributionRows(await fixture(), "2026-08-30")));
  assert.equal(generated, await readFile(expectedPath, "utf8"));
});

test("distribution config supplies defaults while explicit CLI values remain supported", async () => {
  assert.deepEqual(await resolveDistributionOptions(root, { check: true }), {
    input: join(root, "data/master/canonical.json"),
    output: join(root, "data/master/public-burdens.csv"),
    asOf: "2026-08-18",
    check: true
  });
  assert.deepEqual(await resolveDistributionOptions(root, { input: "custom.json", output: ".cache/custom.csv", "as-of": "2019-10-01" }), {
    input: join(root, "custom.json"),
    output: join(root, ".cache/custom.csv"),
    asOf: "2019-10-01",
    check: false
  });
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.generate, "node scripts/cli/public-burden-csv.js");
  assert.equal(packageJson.scripts["generate:check"], "node scripts/cli/public-burden-csv.js --check && npm run master-contract:check");
});

test("calculated values fail when their inputs or output component trace is broken", async () => {
  const master = await fixture();
  master.calculation_sets[0].input_source_fact_ids = ["missing-fact"];
  master.calculation_sets[1].output_component_ids = ["pension-insured-component"];
  const errors = validateMasterIntegrity(master);
  assert.ok(errors.some((error) => error.includes("unknown reference missing-fact")));
  assert.ok(errors.some((error) => error.includes("does not output pension-employer-component")));
});

test("direct and calculated numeric values cannot drift from their evidence", async () => {
  const master = await fixture();
  master.burden_components[0].versions[0].value.numeric_value = 6;
  master.burden_components.find(({ component_id }) => component_id === "pension-insured-component").versions[0].value.numeric_value = 9;
  const errors = validateMasterIntegrity(master);
  assert.ok(errors.some((error) => error.includes("direct value differs from source fact")));
  assert.ok(errors.some((error) => error.includes("calculated value does not match pension-equal-split")));
});
