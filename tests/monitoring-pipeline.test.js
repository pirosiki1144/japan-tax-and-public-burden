import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOperationalJobs, runOperationalMonitoring } from "../scripts/pipeline/monitoring-pipeline.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(root, "tests/fixtures/source-scan");
const semanticBaselinePath = join(root, "tests/fixtures/semantic-extraction/expected-baseline.json");
const now = () => new Date("2026-08-19T12:34:56+09:00");

async function fixtureFetch(url) {
  const name = basename(new URL(url).pathname);
  const body = await readFile(join(fixtureRoot, name));
  const contentType = name.endsWith(".pdf") ? "application/pdf" : body.toString("utf8", 0, Math.min(body.length, 32)).trimStart().startsWith("{") ? "application/json" : "text/html; charset=UTF-8";
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function sourceScan(results) {
  return async () => ({
    schema_version: 1,
    status: results.some(({ status }) => status === "error") ? "error" : results.some(({ status }) => status === "change_detected") ? "change_detected" : "no_change",
    dry_run: true,
    completed_at: now().toISOString(),
    results
  });
}

const evidence = [{ source_url: "https://example.go.jp/source", fetched_at: now().toISOString(), sha256: "a".repeat(64) }];

test("the inventory drives source and semantic adapters through one offline pipeline", async () => {
  const result = await runOperationalMonitoring({ root, fetchImpl: fixtureFetch, now, dryRun: true, semanticBaselinePath });
  assert.equal(result.status, "no_change");
  assert.equal(result.registry.targets_total, 112);
  assert.equal(result.registry.semantic_jobs_run, 31);
  assert.deepEqual(result.registry.batches_run, ["issue-39-batch-01", "issue-42-batch-01", "issue-43-common-source-01", "issue-42-batch-02"]);
  assert.deepEqual(result.routing, { has_changes: false, has_findings: false, pr_candidate_count: 0, issue_candidate_count: 0 });
  assert.equal(result.results.length, 36);
  assert.equal(result.results.filter(({ source_id }) => source_id.startsWith("semantic:")).length, 31);
});

test("a certain mapped change is routed to the existing PR candidate path", async () => {
  const target = { file: "data/phases/sample.yaml", record_id_field: "phase_id", record_id: "sample", path: "value.numeric_value" };
  const result = await runOperationalMonitoring({
    root, now, dryRun: true,
    sourceRunner: sourceScan([{ source_id: "official", status: "change_detected", fetches: evidence, candidate_diff: [{ fact_id: "rate", target, current: 1, candidate: 2 }] }]),
    semanticRunner: async () => ({ record: { observed: true }, fetches: evidence, candidate_diff: [] })
  });
  assert.equal(result.status, "change_detected");
  assert.deepEqual(result.routing, { has_changes: true, has_findings: false, pr_candidate_count: 1, issue_candidate_count: 0 });
});

test("one semantic adapter failure does not starve later targets and routes an Issue", async () => {
  const called = [];
  const result = await runOperationalMonitoring({
    root, now, dryRun: true,
    sourceRunner: sourceScan([{ source_id: "official", status: "no_change", fetches: evidence, candidate_diff: [] }]),
    semanticRunner: async ({ taxId }) => {
      called.push(taxId);
      if (taxId === "automobile-tax") throw new Error("Article 154 matched 0 nodes");
      return { record: { tax_id: taxId }, fetches: evidence, candidate_diff: [] };
    }
  });
  assert.equal(called.length, 31);
  assert.ok(called.indexOf("consumption-tax") > called.indexOf("automobile-tax"));
  assert.ok(called.includes("tonnage-tax"));
  assert.equal(result.status, "error");
  assert.equal(result.results.find(({ tax_id }) => tax_id === "automobile-tax").error_code, "source_structure_changed");
  assert.deepEqual(result.routing, { has_changes: false, has_findings: true, pr_candidate_count: 0, issue_candidate_count: 1 });
});

test("an actual e-Gov fixture structure change retains other target results", async () => {
  const changedFetch = async (url) => {
    const response = await fixtureFetch(url);
    if (!url.endsWith("325AC0000000226")) return response;
    const document = await response.json();
    const main = document.law_full_text.children.find(({ tag }) => tag === "MainProvision");
    main.children = main.children.filter((node) => node.attr?.Num !== "154");
    return new Response(JSON.stringify(document), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runOperationalMonitoring({ root, fetchImpl: changedFetch, now, dryRun: true, semanticBaselinePath });
  assert.equal(result.status, "error");
  assert.equal(result.results.find(({ tax_id }) => tax_id === "automobile-tax").error_code, "source_structure_changed");
  assert.equal(result.results.find(({ tax_id }) => tax_id === "consumption-tax").status, "no_change");
  assert.equal(result.routing.issue_candidate_count, 1);
});

test("a real fixture value change produces an item-level semantic review finding", async () => {
  const changedFetch = async (url) => {
    const response = await fixtureFetch(url);
    if (!url.endsWith("325AC0000000226")) return response;
    return new Response((await response.text()).replace("七千五百円", "七千六百円"), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runOperationalMonitoring({ root, fetchImpl: changedFetch, now, dryRun: true, semanticBaselinePath });
  const semantic = result.results.find(({ tax_id }) => tax_id === "automobile-tax");
  assert.equal(semantic.status, "change_detected");
  assert.ok(semantic.candidate_diff.some(({ fact_id, current, candidate }) => fact_id === "semantic:rates[0].amount_yen" && current === 7500 && candidate === 7600));
  assert.equal(result.routing.has_changes, false);
  assert.equal(result.routing.issue_candidate_count, 1);
});

test("an unmapped semantic change is routed for human review instead of a PR", async () => {
  const result = await runOperationalMonitoring({
    root, now, dryRun: true,
    sourceRunner: sourceScan([{ source_id: "official", status: "no_change", fetches: evidence, candidate_diff: [] }]),
    semanticRunner: async ({ taxId }) => ({
      record: { tax_id: taxId }, fetches: evidence,
      candidate_diff: taxId === "automobile-tax" ? [{ fact_id: "new-rate", target: null, current: 7500, candidate: 7600 }] : []
    })
  });
  assert.equal(result.status, "change_detected");
  assert.deepEqual(result.routing, { has_changes: false, has_findings: true, pr_candidate_count: 0, issue_candidate_count: 1 });
});

test("batch selection is registry-backed and held implementation batches stay empty", async () => {
  const selected = await loadOperationalJobs(root, { batchId: "issue-39-batch-01" });
  assert.equal(selected.jobs.length, 2);
  const national = await loadOperationalJobs(root, { batchId: "issue-42-batch-01" });
  assert.ok(national.jobs.length > 0);
  const local = await loadOperationalJobs(root, { batchId: "issue-43-common-source-01" });
  assert.equal(local.jobs.length, 15);
  await assert.rejects(runOperationalMonitoring({ root, batchId: "issue-44-batch-01", sourceRunner: sourceScan([]) }), /No implemented adapter jobs/);
});

test("shared local-tax law data is fetched once per monitoring run", async () => {
  const calls = new Map();
  const countedFetch = async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    return fixtureFetch(url);
  };
  const result = await runOperationalMonitoring({ root, fetchImpl: countedFetch, now, dryRun: true, semanticBaselinePath, sourceRunner: sourceScan([]) });
  assert.equal(result.status, "no_change");
  const localLawUrl = result.results.find(({ tax_id }) => tax_id === "bathing-tax").fetches[0].source_url;
  assert.equal(calls.get(localLawUrl), 1);
});
