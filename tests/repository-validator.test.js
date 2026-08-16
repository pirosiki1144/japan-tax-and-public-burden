import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateRepository } from "../scripts/validate/repository-validator.js";
import { createValidators, validateDocument } from "../scripts/validate/schema-validator.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("all canonical repository data passes schema and integrity validation", async () => {
  const { errors, collections } = await validateRepository(root);
  assert.deepEqual(errors, []);
  assert.ok(collections.burdens.some(({ tax_id }) => tax_id === "consumption-tax"));
  assert.equal(collections.phases.filter(({ tax_id }) => tax_id === "consumption-tax").length, 2);
});

test("validation workflow runs only for pull requests", async () => {
  const workflow = parse(await readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8"));
  assert.ok(Object.hasOwn(workflow.on, "pull_request"));
  assert.ok(!Object.hasOwn(workflow.on, "push"));
});

test("revenue schema distinguishes an unavailable amount from zero", async () => {
  const schemaPath = fileURLToPath(new URL("../schemas/revenue.schema.json", import.meta.url));
  const { revenue } = await createValidators({ revenue: schemaPath });
  const unavailable = {
    record_id: "sample-record", tax_id: "consumption-tax", fiscal_year: "2025",
    period_start: "2025-04-01", period_end: "2026-03-31", amount_yen: "",
    amount_raw: "未集計", amount_kind: "tax_revenue", accounting_basis: "settlement",
    government_level: "national", collector: "sample", account_or_fund: "sample",
    gross_or_net: "gross", refund_treatment: "unknown", consolidation_scope: "sample",
    value_status: "not_yet_compiled", evidence_gap_reason: "公式の確定値が未公表",
    source_url: "https://example.go.jp/source", source_page_or_table: "sample",
    published_at: "2026-08-17T00:00:00+09:00", verified_at: "2026-08-17T00:00:00+09:00", notes: ""
  };
  assert.deepEqual(validateDocument(revenue, unavailable, "unavailable"), []);
  assert.notDeepEqual(validateDocument(revenue, { ...unavailable, evidence_gap_reason: "" }, "invalid"), []);
  assert.notDeepEqual(validateDocument(revenue, { ...unavailable, amount_yen: "0" }, "invalid"), []);
});
