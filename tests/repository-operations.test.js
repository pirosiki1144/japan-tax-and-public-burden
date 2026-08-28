import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { auditRepository, auditScan, generateDistribution, monitorSources, scanSources, validateData } from "../scripts/application/repository-operations.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("scan and monitor application services are callable without a CLI", async () => {
  const one = await scanSources({ scanAll: false, marker: 1, runOne: async ({ marker }) => ({ marker }), runAll: async () => null });
  const all = await scanSources({ scanAll: true, marker: 2, runOne: async () => null, runAll: async ({ marker }) => ({ marker }) });
  const monitor = await monitorSources({ marker: 3, run: async ({ marker }) => ({ marker }) });
  assert.deepEqual([one, all, monitor], [{ marker: 1 }, { marker: 2 }, { marker: 3 }]);
});

test("validation and audit services keep errors explicit", async () => {
  assert.deepEqual(await validateData({ root, file: "x", validateRepository: async () => ({ errors: [] }) }), { errors: ["Both --file and --schema are required."] });
  assert.deepEqual(await validateData({ root, validateRepository: async () => ({ errors: ["broken"], collections: {} }) }), { errors: ["broken"], collections: {} });
  const report = await auditRepository({ root, asOf: "2026-08-28", now: () => new Date("2026-08-28T00:00:00Z"), validateRepository: async () => ({ errors: ["broken"], collections: {} }) });
  assert.equal(report.status, "error");
  assert.equal(report.findings[0].code, "schema_or_integrity_error");
  const scanAudit = auditScan({ schema_version: 1, status: "error", results: [{ source_id: "x", status: "error", error: "failed", fetches: [] }] });
  assert.equal(scanAudit.status, "needs_review");
  assert.equal(scanAudit.issue_candidates.length, 1);
});

test("generation uses an injected atomic file store in write and check modes", async () => {
  const artifacts = new Map([["a.json", "{}\n"]]);
  const writes = [];
  const fileStore = {
    writeNamedTexts: async (directory, values) => writes.push([directory, values]),
    listFileNames: async () => ["a.json"],
    readNamedTexts: async () => artifacts
  };
  assert.deepEqual(await generateDistribution({ root, outputDirectory: "/tmp/generated", check: false, buildArtifacts: async () => artifacts, fileStore }), { status: "generated", files: 1 });
  assert.equal(writes.length, 1);
  assert.deepEqual(await generateDistribution({ root, outputDirectory: "/tmp/generated", check: true, buildArtifacts: async () => artifacts, fileStore }), { status: "clean", files: 1 });
});

test("primary CLI files contain only orchestration and no extraction implementation", async () => {
  for (const path of ["scripts/pipeline/scan-source.js", "scripts/pipeline/run-monitoring.js", "scripts/validate/validate-data.js", "scripts/generate/generate-distribution.js", "scripts/audit/audit-repository.js"]) {
    const source = await readFile(`${root}/${path}`, "utf8");
    assert.doesNotMatch(source, /normalize|pdfjs-dist|canonical-diff|auditRepositoryCollections|validateDocument/);
  }
});
