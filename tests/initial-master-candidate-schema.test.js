import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("initial import keeps candidate identities and review dispositions", async () => {
  const data = JSON.parse(await readFile(new URL("../data/master/initial-import.json", import.meta.url), "utf8"));
  const ids = data.candidates.map(({ source_record_id }) => source_record_id);
  assert.equal(new Set(ids).size, 119);
  assert.equal(data.candidates.filter(({ disposition }) => disposition === "pending").length, 118);
  assert.equal(data.candidates.filter(({ disposition }) => disposition === "merged").length, 1);
  assert.ok(data.candidates.every(({ reason, record }) => reason.length > 0 && record && typeof record === "object"));
});

test("candidate source records preserve collector arrays without duplicates", async () => {
  const data = JSON.parse(await readFile(new URL("../data/master/initial-import.json", import.meta.url), "utf8"));
  const records = data.candidates.map(({ record }) => record);
  assert.ok(records.some(({ collectors = [] }) => collectors.length > 0));
  assert.ok(records.every(({ collectors = [] }) => new Set(collectors).size === collectors.length));
});
