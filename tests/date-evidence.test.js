import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { createValidators, validateDocument } from "../scripts/validate/schema-validator.js";

const changeSchema = fileURLToPath(new URL("../schemas/change.schema.json", import.meta.url));
const burdenSchema = fileURLToPath(new URL("../schemas/burden.schema.json", import.meta.url));
const changePath = new URL("../data/changes/consumption-tax-2019-rate.yaml", import.meta.url);
const burdenPath = new URL("../data/burdens/consumption-tax.yaml", import.meta.url);

test("all four legal dates remain separate and unknown dates require evidence gaps", async () => {
  const { change } = await createValidators({ change: changeSchema });
  const record = parse(await readFile(changePath, "utf8"));
  assert.deepEqual(validateDocument(change, record, "change"), []);

  const missingField = structuredClone(record);
  delete missingField.promulgation_date;
  assert.ok(validateDocument(change, missingField, "missing").some((message) => message.includes("promulgation_date")));

  const inferredUnknown = structuredClone(record);
  delete inferredUnknown.enforcement_date.evidence_gap_reason;
  assert.ok(validateDocument(change, inferredUnknown, "unknown").some((message) => message.includes("evidence_gap_reason")));
});

test("burden main status cannot contain a legislative procedure stage", async () => {
  const { burden } = await createValidators({ burden: burdenSchema });
  const record = parse(await readFile(burdenPath, "utf8"));
  record.current_status = "promulgated";
  assert.notDeepEqual(validateDocument(burden, record, "burden"), []);
});
