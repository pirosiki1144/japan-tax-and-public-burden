import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createValidators, validateDocument } from "../scripts/validate/schema-validator.js";

const candidateSchema = fileURLToPath(new URL("../schemas/initial-master-candidate.schema.json", import.meta.url));

function candidate(overrides = {}) {
  return {
    candidate_id: "sample-candidate",
    name_raw: "サンプル負担",
    official_name: "unknown",
    aliases: [],
    burden_type: "contribution",
    legal_mandate_type: "unknown",
    jurisdiction: "unknown",
    liable_party: "unknown",
    collectors: ["unknown"],
    current_status: null,
    coverage_status: "candidate",
    source_urls: ["https://example.go.jp/source"],
    verified_at: "2026-08-18T00:00:00+09:00",
    evidence_gaps: ["正式名称、根拠法令、状態を追加確認する"],
    decision_note: "公式資料から抽出した初期候補",
    ...overrides
  };
}

test("national tax, local tax, and non-tax candidates are mutually exclusive valid types", async () => {
  const { candidate: validate } = await createValidators({ candidate: candidateSchema });
  for (const burdenType of ["national_tax", "local_tax", "social_insurance_premium", "contribution", "levy", "burden_charge"]) {
    assert.deepEqual(validateDocument(validate, candidate({ burden_type: burdenType }), burdenType), []);
  }

  const invalid = candidate({ burden_type: "contribution", tax_level: "national" });
  assert.ok(validateDocument(validate, invalid, "non-tax-with-tax-level").some((message) => message.includes("additional properties")));
});

test("unknown candidate status requires an evidence gap", async () => {
  const { candidate: validate } = await createValidators({ candidate: candidateSchema });
  assert.deepEqual(validateDocument(validate, candidate(), "candidate"), []);
  assert.ok(validateDocument(validate, candidate({ evidence_gaps: [] }), "candidate").some((message) => message.includes("must NOT have fewer than 1 items")));
});

test("confirmed candidates require a known official name and one of the four main statuses", async () => {
  const { candidate: validate } = await createValidators({ candidate: candidateSchema });
  const valid = candidate({
    official_name: "サンプル負担",
    legal_mandate_type: "mandatory_by_law",
    jurisdiction: "Japan",
    liable_party: "事業者",
    collectors: ["所管機関"],
    current_status: "active",
    coverage_status: "confirmed",
    evidence_gaps: []
  });
  assert.deepEqual(validateDocument(validate, valid, "confirmed"), []);

  const invalid = candidate({ coverage_status: "confirmed" });
  const errors = validateDocument(validate, invalid, "confirmed-invalid");
  assert.ok(errors.some((message) => message.includes("must NOT be valid")));
  assert.ok(errors.some((message) => message.includes("must be string")));
});

test("multiple collectors are preserved as separate values", async () => {
  const { candidate: validate } = await createValidators({ candidate: candidateSchema });
  const value = candidate({ collectors: ["国税庁", "税関"] });
  assert.deepEqual(validateDocument(validate, value, "multiple-collectors"), []);
  assert.deepEqual(value.collectors, ["国税庁", "税関"]);
  assert.ok(validateDocument(validate, candidate({ collectors: ["国税庁", "国税庁"] }), "duplicate-collectors").some((message) => message.includes("duplicate items")));
});
