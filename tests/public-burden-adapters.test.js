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
    ...plan.manual_targets.map(({ tax_id }) => tax_id),
    ...plan.held_groups.flatMap(({ tax_ids }) => tax_ids)
  ];
  assert.equal(issueTargets.length, 60);
  assert.equal(new Set(decisions).size, decisions.length);
  assert.deepEqual(decisions.toSorted(), issueTargets.map(({ tax_id }) => tax_id).toSorted());
  assert.ok(plan.held_groups.every(({ hold_reason }) => hold_reason.length >= 30));
  assert.equal(issueTargets.filter(({ implementation_status }) => implementation_status === "implemented").length, 2);
  assert.equal(issueTargets.filter(({ implementation_status }) => implementation_status === "held").length, 58);
});

test("Issue 56 targets are implemented or have actionable manual review metadata", async () => {
  const plan = await readYaml(new URL("../config/public-burden-adapters.yaml", import.meta.url));
  const issue56 = new Set(["automobile-accident-countermeasure-levy","commodity-customer-protection-fund-charge","common-utility-tunnel-charge","educational-public-transmission-compensation","imported-sugar-adjustment-charge","investor-protection-fund-charge","library-public-transmission-compensation","multipurpose-dam-charge","pollution-prevention-project-business-charge","port-environment-improvement-charge","postal-transport-consignment-compensation","private-recording-compensation"]);
  const implemented = plan.implemented_targets.filter(({ tax_id }) => issue56.has(tax_id));
  const manual = plan.manual_targets.filter(({ tax_id }) => issue56.has(tax_id));
  assert.deepEqual(implemented.map(({ tax_id }) => tax_id), ["educational-public-transmission-compensation"]);
  assert.equal(manual.length, 11);
  assert.equal(new Set([...implemented, ...manual].map(({ tax_id }) => tax_id)).size, 12);
  assert.ok(manual.every(({ official_source_url, value_scope, evidence_gap, release_conditions, recheck_cadence }) => official_source_url.startsWith("https://") && value_scope.length >= 20 && evidence_gap.length >= 20 && release_conditions.length >= 1 && ["monthly","quarterly","annual"].includes(recheck_cadence)));
  assert.ok(manual.every(({ value_scope }) => /単一|集計しない/.test(value_scope)));
});

test("educational public transmission values are reproduced offline and stay separate", async () => {
  const plan = await readYaml(new URL("../config/public-burden-adapters.yaml", import.meta.url));
  const result = await runSourcePipeline({ root, sourceId: "mext-educational-public-transmission-compensation", fetchImpl: fixtureFetch, now, dryRun: true });
  assert.equal(result.status, "no_change");
  const facts = new Map(result.normalized.facts.map(({ fact_id, value }) => [fact_id, value]));
  const target = plan.implemented_targets.find(({ tax_id }) => tax_id === "educational-public-transmission-compensation");
  assert.deepEqual(target.components.map(({ numeric_value }) => numeric_value), [120, 180, 420, 720]);
  assert.ok(target.components.every(({ fact_id, numeric_value, aggregation_role, included_in_total, period_start }) => facts.get(fact_id) === numeric_value && aggregation_role === "standalone" && included_in_total === false && period_start === null));
});

test("educational compensation changes and missing approval markers fail closed", async () => {
  const changedFetch = async (url) => {
    const response = await fixtureFetch(url);
    return new Response((await response.text()).replace("小学校120円", "小学校130円"), { status: 200, headers: { "content-type": "text/html" } });
  };
  const changed = await runSourcePipeline({ root, sourceId: "mext-educational-public-transmission-compensation", fetchImpl: changedFetch, now, dryRun: true });
  assert.equal(changed.status, "change_detected");
  assert.deepEqual(changed.candidate_diff.map(({ fact_id, current, candidate }) => ({ fact_id, current, candidate })), [{ fact_id: "elementary-school-amount", current: 120, candidate: 130 }]);
  await assert.rejects(runSourcePipeline({
    root, sourceId: "mext-educational-public-transmission-compensation", now, dryRun: true,
    fetchImpl: async (url) => {
      const response = await fixtureFetch(url);
      return new Response((await response.text()).replace("補償金の額は、文化庁長官によって認可", "認可情報なし"), { status: 200, headers: { "content-type": "text/html" } });
    }
  }), /approved compensation was not found/);
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
