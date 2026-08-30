import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  for (const path of ["scripts/cli/scan-source.js", "scripts/cli/run-monitoring.js", "scripts/cli/validate-data.js", "scripts/cli/audit-repository.js"]) {
    const source = await readFile(`${root}/${path}`, "utf8");
    assert.doesNotMatch(source, /normalize|pdfjs-dist|canonical-diff|auditRepositoryCollections|validateDocument/);
  }
});

test("moved CLIs preserve missing-argument stderr and exit codes", () => {
  const cases = [
    ["scripts/cli/prepare-update.js", "Usage: node scripts/automation/prepare-update.js --scan <result.json> --report <pr-body.md>\n"],
    ["scripts/cli/write-semantic-baseline.js", "Usage: node scripts/monitoring/write-semantic-baseline.js --input <reviewed-run.json> --output <review.json> --confirm-reviewed\n"],
    ["scripts/cli/run-monitoring.js", "Usage: node scripts/pipeline/run-monitoring.js --output <result.json> [--fixture-dir <dir>] [--batch <id>] [--dry-run]\n"],
    ["scripts/cli/audit-source-scan.js", "Usage: node scripts/audit/audit-source-scan.js --scan <scan.json> --report <audit.json>\n"],
    ["scripts/cli/publish-audit-issues.js", "Usage: node scripts/audit/publish-audit-issues.js --report <audit.json>\n"]
  ];
  for (const [path, stderr] of cases) {
    const result = spawnSync(process.execPath, [path], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 2, path);
    assert.equal(result.stdout, "", path);
    assert.equal(result.stderr, stderr, path);
  }
});
