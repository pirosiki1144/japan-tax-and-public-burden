import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { applyCandidateUpdates, buildPullRequestBody } from "../scripts/automation/candidate-update.js";

const evidence = [{ source_url: "https://example.go.jp/official", fetched_at: "2026-08-17T01:02:03.000Z", sha256: "a".repeat(64) }];

function scanWith(candidateDiff, status = "change_detected") {
  return {
    schema_version: 1,
    status,
    results: [{ source_id: "official-source", status, fetches: evidence, candidate_diff: candidateDiff }]
  };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "candidate-update-"));
  await mkdir(join(root, "data/phases"), { recursive: true });
  await writeFile(join(root, "data/phases/sample.yaml"), "- phase_id: sample-phase\n  value:\n    numeric_value: 7.8\n", "utf8");
  return root;
}

function difference(candidate = 7.9) {
  return {
    fact_id: "sample-rate",
    target: { file: "data/phases/sample.yaml", record_id_field: "phase_id", record_id: "sample-phase", path: "value.numeric_value" },
    current: 7.8,
    candidate,
    raw: "7.9 percent"
  };
}

test("a deterministic candidate updates only its declared canonical target", async () => {
  const root = await fixtureRoot();
  const scan = scanWith([difference()]);
  const result = await applyCandidateUpdates({ root, scan });
  const document = parse(await readFile(join(root, "data/phases/sample.yaml"), "utf8"));
  assert.equal(document[0].value.numeric_value, 7.9);
  assert.equal(result.applied.length, 1);
  const body = buildPullRequestBody({ scan, changes: result.changes });
  assert.match(body, /Related to #9/);
  assert.match(body, /https:\/\/example\.go\.jp\/official/);
  assert.match(body, /7\.8.*7\.9/);
});

test("a repeated candidate is idempotent", async () => {
  const root = await fixtureRoot();
  const scan = scanWith([difference()]);
  await applyCandidateUpdates({ root, scan });
  const second = await applyCandidateUpdates({ root, scan });
  assert.equal(second.applied.length, 0);
});

test("source errors, untargeted changes, and stale canonical values stop safely", async () => {
  const root = await fixtureRoot();
  await assert.rejects(applyCandidateUpdates({ root, scan: { schema_version: 1, status: "error", results: [{ source_id: "bad", status: "error" }] } }), /source errors/);
  await assert.rejects(applyCandidateUpdates({ root, scan: scanWith([{ ...difference(), target: null }]) }), /human review/);
  await writeFile(join(root, "data/phases/sample.yaml"), "- phase_id: sample-phase\n  value:\n    numeric_value: 8.1\n", "utf8");
  await assert.rejects(applyCandidateUpdates({ root, scan: scanWith([difference()]) }), /changed since scan/);
});

test("conflicting duplicate targets are rejected before writing", async () => {
  const root = await fixtureRoot();
  await assert.rejects(applyCandidateUpdates({ root, scan: scanWith([difference(7.9), difference(8.0)]) }), /Conflicting candidates/);
  const document = parse(await readFile(join(root, "data/phases/sample.yaml"), "utf8"));
  assert.equal(document[0].value.numeric_value, 7.8);
});
