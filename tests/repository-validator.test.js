import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateRepository } from "../scripts/validate/repository-validator.js";
import { createValidators, validateDocument } from "../scripts/validate/schema-validator.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("all canonical repository data passes schema and integrity validation", async () => {
  const { errors, collections } = await validateRepository(root);
  assert.deepEqual(errors, []);
  assert.ok(collections.burdens.some(({ tax_id }) => tax_id === "consumption-tax"));
  assert.equal(collections.masters[0].burden_components.filter(({ public_burden_id }) => public_burden_id === "consumption-tax").length, 2);
});

test("validation workflow runs only for pull requests", async () => {
  const workflow = parse(await readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8"));
  assert.ok(Object.hasOwn(workflow.on, "pull_request"));
  assert.ok(!Object.hasOwn(workflow.on, "push"));
  assert.ok(workflow.jobs.validate.steps.some(({ run }) => run === "npm run monitoring:check"));
  assert.ok(workflow.jobs.validate.steps.some(({ run }) => run === "npm run monitoring:plan:check"));
  assert.ok(workflow.jobs.validate.steps.some(({ run }) => run === "npm run audit:coverage"));
  assert.ok(workflow.jobs.validate.steps.some(({ run }) => run === "npm run semantics:check"));
  assert.ok(workflow.jobs.validate.steps.some(({ run }) => run === "npm run monitor:check"));
  assert.ok(workflow.jobs.validate.steps.some(({ run }) => run === "npm run generate:check"));
});

test("source scan workflow is fixed, scheduled, and manually runnable", async () => {
  const workflow = parse(await readFile(new URL("../.github/workflows/source-scan.yml", import.meta.url), "utf8"));
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.ok(Object.hasOwn(workflow.on, "schedule"));
  assert.ok(!Object.hasOwn(workflow.on, "push"));
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs["update-pr"].permissions.contents, "write");
  assert.equal(workflow.jobs["update-pr"].permissions["pull-requests"], "write");
  assert.equal(workflow.jobs["update-pr"].needs, "scan");
  assert.equal(workflow.jobs["audit-issues"].permissions.contents, "read");
  assert.equal(workflow.jobs["audit-issues"].permissions.issues, "write");
  assert.equal(workflow.jobs["audit-issues"].needs, "scan");
  assert.match(workflow.jobs["audit-issues"].if, /always\(\)/);
  assert.equal(workflow.concurrency.group, "official-source-update");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const scanCommands = workflow.jobs.scan.steps.map(({ run }) => run).filter(Boolean);
  const updateCommands = workflow.jobs["update-pr"].steps.map(({ run }) => run).filter(Boolean);
  assert.ok(scanCommands.includes("npm test"));
  assert.ok(scanCommands.includes("npm run validate"));
  assert.ok(scanCommands.includes("npm run monitoring:check"));
  assert.ok(scanCommands.includes("npm run monitoring:plan:check"));
  assert.ok(scanCommands.includes("npm run generate:check"));
  assert.ok(scanCommands.some((command) => command.includes("npm run audit")));
  assert.ok(scanCommands.some((command) => command.includes("npm run monitor")));
  assert.ok(scanCommands.some((command) => command.includes("npm run audit:scan")));
  assert.equal(workflow.jobs["coverage-audit"].strategy["fail-fast"], false);
  assert.match(workflow.jobs["coverage-audit"].strategy.matrix.batch, /fromJSON/);
  assert.equal(workflow.jobs.scan.needs, "coverage-audit");
  assert.equal(workflow.jobs.scan.if, "always()");
  assert.ok(workflow.jobs["coverage-plan"].steps.some(({ run }) => run?.includes("audit:coverage")));
  assert.ok(workflow.jobs["coverage-audit"].steps.some(({ uses }) => uses === "actions/upload-artifact@v4"));
  assert.ok(updateCommands.some((command) => command.includes("npm run prepare-update")));
  assert.ok(updateCommands.some((command) => command.includes("npm run generate") && command.includes("git add data generated")));
  assert.ok(updateCommands.some((command) => command.includes("gh pr list") && command.includes("gh pr edit") && command.includes("gh pr create")));
  assert.ok([...scanCommands, ...updateCommands].every((command) => !command.includes("gh pr merge")));
  const issueCommands = workflow.jobs["audit-issues"].steps.map(({ run }) => run).filter(Boolean);
  assert.ok(issueCommands.some((command) => command.includes("npm run audit:issues")));
});
