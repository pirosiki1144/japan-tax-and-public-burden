import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createValidators, readYaml, validateDocument } from "../scripts/validate/schema-validator.js";

const burdenSchema = fileURLToPath(new URL("../schemas/burden.schema.json", import.meta.url));
const invalidFixture = fileURLToPath(new URL("./fixtures/invalid-burden.yaml", import.meta.url));

test("invalid burden data is rejected by its JSON Schema", async () => {
  const { burden } = await createValidators({ burden: burdenSchema });
  const invalid = {
    tax_id: "Invalid ID",
    official_name: "テスト税",
    burden_type: "unsupported_type",
    unexpected_property: true
  };

  const errors = validateDocument(burden, invalid, "invalid-burden.yaml");
  assert.ok(errors.some((message) => message.includes("required property")));
  assert.ok(errors.some((message) => message.includes("additional properties")));
  assert.ok(errors.some((message) => message.includes("must match pattern")));
  assert.ok(errors.some((message) => message.includes("must be equal to one of the allowed values")));
});

test("invalid data written in general YAML syntax is rejected", async () => {
  const { burden } = await createValidators({ burden: burdenSchema });
  const invalid = await readYaml(invalidFixture);
  const errors = validateDocument(burden, invalid, invalidFixture);
  assert.ok(errors.some((message) => message.includes("required property")));
  assert.ok(errors.some((message) => message.includes("additional properties")));
  assert.ok(errors.some((message) => message.includes("must match pattern")));
  assert.ok(errors.some((message) => message.includes("allowed values")));
});
