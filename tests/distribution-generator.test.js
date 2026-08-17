import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { buildDistributionArtifacts, buildSummary, compareArtifactSets } from "../scripts/generate/distribution-generator.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("the same canonical input produces byte-identical artifacts", async () => {
  const first = await buildDistributionArtifacts(root);
  const second = await buildDistributionArtifacts(root);
  assert.deepEqual([...first], [...second]);
  assert.equal(first.size, 6);
});

test("current and history outputs use the requested point in time", async () => {
  const artifacts = await buildDistributionArtifacts(root, { asOf: "2018-01-01" });
  const current = JSON.parse(artifacts.get("current.json"));
  const history = JSON.parse(artifacts.get("history.json"));
  assert.equal(current.as_of, "2018-01-01");
  assert.equal(current.records[0].current_status, "not_applied");
  assert.deepEqual(current.records[0].active_phases, []);
  assert.deepEqual(current.records[0].pending_changes.map(({ change_id }) => change_id), ["consumption-tax-2019-rate"]);
  assert.equal(history.phases.length, 2);
  assert.equal(history.events.length, 1);
  assert.ok(history.sources.some(({ source_id }) => source_id === "nta-consumption-tax-rates"));
});

test("CSV outputs preserve rate metadata and full history payloads", async () => {
  const artifacts = await buildDistributionArtifacts(root);
  const currentRows = parse(artifacts.get("current.csv"), { columns: true, skip_empty_lines: true });
  const historyRows = parse(artifacts.get("history.csv"), { columns: true, skip_empty_lines: true });
  assert.deepEqual(currentRows.map(({ numeric_value, unit, value_status }) => ({ numeric_value, unit, value_status })), [
    { numeric_value: "6.24", unit: "percent", value_status: "confirmed" },
    { numeric_value: "7.8", unit: "percent", value_status: "confirmed" }
  ]);
  const phase = historyRows.find(({ record_type }) => record_type === "phase");
  assert.equal(JSON.parse(phase.payload_json).value.scope.length > 0, true);
});

test("summary excludes inner amounts and does not turn unavailable values into zero", () => {
  const base = {
    tax_id: "sample-tax", fiscal_year: "2025", amount_kind: "tax_revenue", accounting_basis: "settlement",
    government_level: "national", account_or_fund: "general", gross_or_net: "gross", refund_treatment: "excluded", consolidation_scope: "national"
  };
  const collections = { burdens: [], changes: [], events: [], phases: [], revenues: [
    { ...base, record_id: "parent", value_status: "available", amount_yen: "100" },
    { ...base, record_id: "inner", value_status: "included_in_parent_total", amount_yen: "40" },
    { ...base, record_id: "unknown", value_status: "not_yet_compiled", amount_yen: "" }
  ] };
  const group = buildSummary(collections, "2026-08-18").amount_groups[0];
  assert.equal(group.amount_yen, "100");
  assert.deepEqual(group.included_record_ids, ["parent"]);
  assert.deepEqual(group.excluded_inner_record_ids, ["inner"]);
  assert.deepEqual(group.unavailable_record_ids, ["unknown"]);
});

test("direct edits, missing files, and extra files are detected", () => {
  const expected = new Map([["current.json", "canonical"]]);
  assert.deepEqual(compareArtifactSets(expected, new Map([["current.json", "edited"]])), ["current.json: content differs"]);
  assert.deepEqual(compareArtifactSets(expected, new Map()), ["current.json: missing file"]);
  assert.deepEqual(compareArtifactSets(expected, new Map([["current.json", "canonical"], ["extra.json", "x"]])), ["extra.json: unexpected file"]);
});
