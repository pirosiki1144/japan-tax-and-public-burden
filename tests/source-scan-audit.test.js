import test from "node:test";
import assert from "node:assert/strict";
import { auditSourceScan, issueCandidatesFromAudit } from "../scripts/audit/source-scan-audit.js";
import { sha256 } from "../scripts/normalize/sha256.js";
import { publishAuditIssues } from "../scripts/audit/publish-audit-issues.js";

const fetchedAt = "2026-08-17T01:02:03.000Z";
const fetches = [{ source_url: "https://example.go.jp/source", fetched_at: fetchedAt, sha256: "a".repeat(64) }];

test("pure domain SHA-256 preserves the existing digest contract", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("source failures become reproducible issue candidates without changing data", () => {
  const scan = {
    schema_version: 1,
    status: "error",
    completed_at: fetchedAt,
    results: [{ source_id: "official-source", status: "error", error_code: "url_transient_failure", error: "503 after retries", source_url: "https://example.go.jp/source" }]
  };
  const report = auditSourceScan(scan);
  const candidates = issueCandidatesFromAudit(report);
  assert.equal(report.status, "needs_review");
  assert.equal(report.summary.transient_failures, 1);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].body, /正本データは変更していません/);
  assert.match(candidates[0].body, /audit-topic:audit-[a-f0-9]{20}/);
  const changedMessage = auditSourceScan({ ...scan, results: [{ ...scan.results[0], error: "502 after retries" }] });
  assert.equal(changedMessage.findings[0].topic_key, report.findings[0].topic_key);
});

test("unmapped changes and official-source disagreements require review", () => {
  const target = { file: "data/phases/sample.yaml", record_id_field: "phase_id", record_id: "sample-phase", path: "value.numeric_value" };
  const scan = {
    schema_version: 1,
    status: "change_detected",
    completed_at: fetchedAt,
    results: [
      { source_id: "source-a", status: "change_detected", fetches, candidate_diff: [{ fact_id: "unmapped", target: null, current: 1, candidate: 2 }, { fact_id: "rate", target, current: 1, candidate: 2 }] },
      { source_id: "source-b", status: "change_detected", fetches, candidate_diff: [{ fact_id: "rate", target, current: 1, candidate: 3 }] }
    ]
  };
  const report = auditSourceScan(scan);
  assert.ok(report.findings.some(({ code }) => code === "unmapped_official_change"));
  assert.ok(report.findings.some(({ code }) => code === "official_source_disagreement"));
  assert.equal(report.summary.source_disagreements, 1);
  assert.equal(report.reproducibility.length, 2);
});

test("publishing reuses an open topic and creates only missing issues", async () => {
  const candidates = [
    { topic_key: "audit-existing", marker: "[audit-topic:audit-existing]", title: "existing", body: "existing" },
    { topic_key: "audit-new", marker: "[audit-topic:audit-new]", title: "new", body: "new" }
  ];
  const created = [];
  const commented = [];
  const results = await publishAuditIssues({
    candidates,
    findOpen: async (marker) => marker.includes("existing") ? { number: 12, html_url: "https://example.test/12" } : null,
    comment: async (number, candidate) => commented.push([number, candidate.topic_key]),
    create: async (candidate) => {
      created.push(candidate.topic_key);
      return { number: 13, html_url: "https://example.test/13" };
    }
  });
  assert.deepEqual(created, ["audit-new"]);
  assert.deepEqual(commented, [[12, "audit-existing"]]);
  assert.deepEqual(results.map(({ status }) => status), ["updated", "created"]);
});
