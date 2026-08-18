import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildInitialMasterSelection } from "../scripts/generate/initial-master-selection.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("all collected candidates receive a reproducible initial-master decision", async () => {
  const report = await buildInitialMasterSelection(root);
  const tracked = JSON.parse(await readFile(new URL("../reports/initial-master-selection.json", import.meta.url), "utf8"));

  assert.deepEqual(report, tracked);
  assert.deepEqual(report.counts, { candidates: 119, insert: 0, merge_existing: 1, hold: 118, excluded: 0 });
  assert.equal(new Set(report.records.map(({ candidate_id }) => candidate_id)).size, 119);
});

test("existing IDs and similar systems are not incorrectly merged", async () => {
  const report = await buildInitialMasterSelection(root);
  const byId = new Map(report.records.map((record) => [record.candidate_id, record]));

  assert.equal(byId.get("consumption-tax-candidate").disposition, "merge_existing");
  assert.equal(byId.get("consumption-tax-candidate").existing_tax_id, "consumption-tax");
  assert.equal(byId.get("local-consumption-tax").disposition, "hold");
  assert.notEqual(byId.get("local-consumption-tax").proposed_tax_id, byId.get("consumption-tax-candidate").existing_tax_id);
  assert.ok(report.identity_reviews.every(({ relation }) => relation === "distinct"));
});

test("held records preserve state uncertainty and official-source traceability", async () => {
  const report = await buildInitialMasterSelection(root);
  const held = report.records.filter(({ disposition }) => disposition === "hold");

  assert.equal(held.length, 118);
  for (const record of held) {
    assert.equal(record.current_status, null, record.candidate_id);
    assert.ok(record.evidence_gaps.length > 0, record.candidate_id);
    assert.ok(record.source_urls.length > 0, record.candidate_id);
    assert.ok(record.verified_at, record.candidate_id);
  }
});
