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
  assert.equal(report.counts.candidates, 119);
  assert.equal(report.counts.merge_existing, 1);
  assert.equal(report.counts.hold, 118);
  assert.equal(report.counts.law_source_found + report.counts.law_source_not_found, 119);
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

test("e-Gov API law sources are preferred and missing sources remain explicit", async () => {
  const report = await buildInitialMasterSelection(root);
  const found = report.records.filter(({ law_source_status }) => law_source_status === "found");
  const missing = report.records.filter(({ law_source_status }) => law_source_status === "not_found");

  assert.ok(found.length > missing.length);
  assert.ok(found.every(({ status_source_urls }) => status_source_urls.every((url) => /^https:\/\/laws\.e-gov\.go\.jp\/api\/2\/law_data\/[A-Z0-9]+$/.test(url))));
  assert.ok(found.every(({ law_sources_verified_at }) => law_sources_verified_at !== null));
  assert.ok(missing.every(({ current_status_resolution }) => current_status_resolution === "law_source_not_found"));
  assert.ok(missing.every(({ law_source_note }) => law_source_note.includes("一意に特定できない")));
});
