import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("national identifies the National Burden Ratio concept, not a generic jurisdiction", async () => {
  const ratio = JSON.parse(await readFile(new URL("../schemas/national-burden-ratio.schema.json", import.meta.url), "utf8"));
  const mapping = JSON.parse(await readFile(new URL("../schemas/national-burden-ratio-mapping.schema.json", import.meta.url), "utf8"));
  assert.match(ratio.title, /National burden ratio/i);
  assert.match(mapping.title, /National burden ratio reconciliation mapping/i);
  assert.match(mapping.$id, /national-burden-ratio-mapping\.schema\.json$/);
  await assert.rejects(access(new URL("../schemas/national-burden-mapping.schema.json", import.meta.url)));
  await assert.rejects(access(new URL("../data/reconciliation/national-burden-mapping.yaml", import.meta.url)));
});

test("distribution history uses the clarified concept-specific mapping name", async () => {
  const history = JSON.parse(await readFile(new URL("../generated/history.json", import.meta.url), "utf8"));
  assert.equal(history.schema_version, 2);
  assert.ok(Array.isArray(history.national_burden_ratio_mappings));
  assert.equal(Object.hasOwn(history, "national_burden_mappings"), false);
});
