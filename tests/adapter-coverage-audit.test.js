import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { auditAdapterCoverage } from "../scripts/cli/adapter-coverage-audit.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("all targets produce one reviewable coverage row with bounded batches", async () => {
  const report = await auditAdapterCoverage(root);
  assert.equal(report.status, "clean");
  assert.equal(report.summary.targets, 112);
  assert.equal(report.summary.total_targets, 112);
  assert.equal(report.summary.automated + report.summary.manual, 112);
  assert.equal(report.summary.automated, 10);
  assert.equal(report.summary.manual, 102);
  assert.equal(report.summary.implemented_adapters + report.summary.held_adapters, 112);
  assert.equal(new Set(report.targets.map(({ tax_id }) => tax_id)).size, 112);
  assert.equal(report.batches.length, 10);
  assert.ok(report.batches.every(({ within_policy }) => within_policy));
  assert.ok(report.batches.filter(({ targets }) => targets > 20).every(({ reuse_groups }) => reuse_groups === 1));
  assert.ok(report.targets.filter(({ municipal_scope }) => municipal_scope === "issue_20").every(({ implementation_status }) => implementation_status));
});

test("each matrix batch has complete classifications and preserves the global total", async () => {
  const all = await auditAdapterCoverage(root);
  const reports = await Promise.all(all.batches.map(({ batch_id }) => auditAdapterCoverage(root, { batchId: batch_id })));
  assert.ok(reports.every(({ status, summary }) => status === "clean" && summary.batches === 1));
  assert.equal(reports.reduce((sum, { summary }) => sum + summary.targets, 0), 112);
  assert.deepEqual(reports.flatMap(({ targets }) => targets.map(({ tax_id }) => tax_id)).toSorted(), all.targets.map(({ tax_id }) => tax_id).toSorted());
});
