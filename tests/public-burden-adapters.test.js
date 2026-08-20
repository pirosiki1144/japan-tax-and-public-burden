import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../scripts/validate/schema-validator.js";
import { runSourcePipeline } from "../scripts/pipeline/source-pipeline.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(root, "tests/fixtures/source-scan");
const now = () => new Date("2026-08-21T08:30:00+09:00");

async function fixtureFetch(url) {
  const body = await readFile(join(fixtureRoot, basename(new URL(url).pathname)));
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } });
}

test("all Issue 45 targets have exactly one implementation or concrete hold decision", async () => {
  const [plan, inventory] = await Promise.all([
    readYaml(new URL("../config/public-burden-adapters.yaml", import.meta.url)),
    readYaml(new URL("../config/adapter-inventory.yaml", import.meta.url))
  ]);
  const issueTargets = inventory.targets.filter(({ implementation_issue }) => implementation_issue === 45);
  const decisions = [
    ...plan.implemented_targets.map(({ tax_id }) => tax_id),
    ...plan.held_groups.flatMap(({ tax_ids }) => tax_ids)
  ];
  assert.equal(issueTargets.length, 60);
  assert.equal(new Set(decisions).size, decisions.length);
  assert.deepEqual(decisions.toSorted(), issueTargets.map(({ tax_id }) => tax_id).toSorted());
  assert.ok(plan.held_groups.every(({ hold_reason }) => hold_reason.length >= 30));
  assert.equal(issueTargets.filter(({ implementation_status }) => implementation_status === "implemented").length, 1);
  assert.equal(issueTargets.filter(({ implementation_status }) => implementation_status === "held").length, 59);
});

test("disability employment levy amount is reproducible offline", async () => {
  const plan = await readYaml(new URL("../config/public-burden-adapters.yaml", import.meta.url));
  const result = await runSourcePipeline({ root, sourceId: "jeed-disability-employment-levy", fetchImpl: fixtureFetch, now, dryRun: true });
  assert.equal(result.status, "no_change");
  assert.match(result.fetches[0].sha256, /^[a-f0-9]{64}$/);
  const component = plan.implemented_targets[0].components[0];
  const fact = result.normalized.facts.find(({ fact_id }) => fact_id === component.fact_id);
  assert.equal(fact.value, 50000);
  assert.equal(component.period_start, null);
  assert.equal(component.period_precision, "current_rule_no_effective_date_on_overview");
  assert.equal(component.aggregation_role, "standalone");
  assert.equal(component.included_in_total, false);
});

test("changed value and missing scope fail closed", async () => {
  const changedFetch = async (url) => {
    const text = await (await fixtureFetch(url)).text();
    return new Response(text.replace("５０,０００", "４０,０００"), { status: 200, headers: { "content-type": "text/html" } });
  };
  const missingScopeFetch = async (url) => {
    const text = await (await fixtureFetch(url)).text();
    return new Response(text.replace("法定雇用障害者数に不足する障害者数に応じて", "算定条件なし"), { status: 200, headers: { "content-type": "text/html" } });
  };
  const changed = await runSourcePipeline({
    root, sourceId: "jeed-disability-employment-levy", now, dryRun: true,
    fetchImpl: changedFetch
  });
  assert.equal(changed.status, "change_detected");
  assert.deepEqual(changed.candidate_diff.map(({ fact_id, current, candidate }) => ({ fact_id, current, candidate })), [{ fact_id: "monthly-levy-amount", current: 50000, candidate: 40000 }]);
  await assert.rejects(runSourcePipeline({
    root, sourceId: "jeed-disability-employment-levy", now, dryRun: true,
    fetchImpl: missingScopeFetch
  }), /statutory shortfall basis was not found/);
});
