import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../scripts/validate/schema-validator.js";
import { runSourcePipeline } from "../scripts/pipeline/source-pipeline.js";
import { buildMonitoringExecutionPlan } from "../scripts/monitoring/build-monitoring-execution-plan.js";
import { buildDecisionViews, loadMonitoringRegistry } from "../scripts/monitoring/monitoring-registry.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(root, "tests/fixtures/source-scan");
const now = () => new Date("2026-08-21T08:30:00+09:00");
const publicPlan = async () => buildDecisionViews(await loadMonitoringRegistry(root))["public-burden-adapters"];

async function fixtureFetch(url) {
  const name = basename(new URL(url).pathname);
  const body = await readFile(join(fixtureRoot, name));
  const contentType = name.endsWith(".pdf") ? "application/pdf" : "text/html; charset=UTF-8";
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

test("all Issue 45 targets have exactly one implementation or concrete hold decision", async () => {
  const [plan, inventory] = await Promise.all([
    publicPlan(),
    buildMonitoringExecutionPlan(root)
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
  assert.equal(issueTargets.filter(({ implementation_status }) => implementation_status === "implemented").length, 7);
  assert.equal(issueTargets.filter(({ implementation_status }) => implementation_status === "held").length, 53);
});

test("Issue 56 targets are implemented or have actionable manual review metadata", async () => {
  const plan = await publicPlan();
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
  const plan = await publicPlan();
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

test("Issue 57 targets retain variable scopes or one reviewable official value", async () => {
  const plan = await publicPlan();
  const issue57 = new Set(["agricultural-cooperative-savings-charge","agricultural-cooperative-savings-insurance-premium","agricultural-cooperative-savings-special-charge","broadband-service-charge","deposit-insurance-corporation-charge","deposit-insurance-corporation-special-charge","deposit-insurance-premium","international-oil-pollution-fund-annual-contribution","mining-pollution-prevention-fund-contribution","pollution-load-levy","railway-barrier-free-fee","specified-pollution-levy","supplementary-oil-pollution-fund-annual-contribution","universal-service-fee"]);
  const implemented = plan.implemented_targets.filter(({ tax_id }) => issue57.has(tax_id));
  const manual = plan.manual_targets.filter(({ tax_id }) => issue57.has(tax_id));
  assert.deepEqual(implemented.map(({ tax_id }) => tax_id), ["universal-service-fee"]);
  assert.equal(manual.length, 13);
  assert.equal(new Set([...implemented, ...manual].map(({ tax_id }) => tax_id)).size, 14);
  assert.ok(manual.every(({ value_scope, evidence_gap, release_conditions, recheck_cadence }) => value_scope.length >= 20 && evidence_gap.length >= 20 && release_conditions.length >= 1 && ["monthly","quarterly","annual"].includes(recheck_cadence)));
  assert.ok(manual.every(({ value_scope }) => /単一|合算しない|二重計上しない/.test(value_scope)));
});

test("universal service number price and application month are reproduced offline", async () => {
  const plan = await publicPlan();
  const result = await runSourcePipeline({ root, sourceId: "tca-universal-service-number-price", fetchImpl: fixtureFetch, now, dryRun: true });
  assert.equal(result.status, "no_change");
  const facts = new Map(result.normalized.facts.map(({ fact_id, value }) => [fact_id, value]));
  assert.equal(facts.get("universal-service-period-start"), "2026-01-01");
  assert.equal(facts.get("universal-service-number-price"), 2);
  const component = plan.implemented_targets.find(({ tax_id }) => tax_id === "universal-service-fee").components[0];
  assert.equal(component.period_start, "2026-01-01");
  assert.equal(component.period_precision, "month");
  assert.equal(component.numeric_value, 2);
  assert.equal(component.unit, "yen_per_number_month");
  assert.equal(component.included_in_total, false);
});

test("universal service value changes and missing carrier scope fail closed", async () => {
  const changedFetch = async (url) => {
    const response = await fixtureFetch(url);
    return new Response((await response.text()).replace("1番号当たり2円", "1番号当たり3円"), { status: 200, headers: { "content-type": "text/html" } });
  };
  const changed = await runSourcePipeline({ root, sourceId: "tca-universal-service-number-price", fetchImpl: changedFetch, now, dryRun: true });
  assert.equal(changed.status, "change_detected");
  assert.deepEqual(changed.candidate_diff.map(({ fact_id, current, candidate }) => ({ fact_id, current, candidate })), [{ fact_id: "universal-service-number-price", current: 2, candidate: 3 }]);
  await assert.rejects(runSourcePipeline({
    root, sourceId: "tca-universal-service-number-price", now, dryRun: true,
    fetchImpl: async (url) => {
      const response = await fixtureFetch(url);
      return new Response((await response.text()).replace("現在ご利用（ご契約）の電話会社が支払う", "負担主体の記載なし"), { status: 200, headers: { "content-type": "text/html" } });
    }
  }), /carrier liability was not found/);
});

test("Issue 58 targets are implemented or have actionable scope-specific manual metadata", async () => {
  const plan = await publicPlan();
  const issue58 = new Set(["adverse-drug-reaction-contribution","banks-shareholdings-purchase-corporation-contribution","electricity-business-compensation-charge","high-level-waste-disposal-contribution","infection-contribution","irrigation-water-facility-charge","participant-protection-trust-charge","pharmaceutical-safety-contribution","policyholder-protection-fund-charge","tru-waste-disposal-contribution","utility-tunnel-management-charge","utility-tunnel-other-occupant-charge","utility-tunnel-planned-occupant-construction-charge","water-resources-facility-user-charge"]);
  const implemented = plan.implemented_targets.filter(({ tax_id }) => issue58.has(tax_id));
  const manual = plan.manual_targets.filter(({ tax_id }) => issue58.has(tax_id));
  assert.deepEqual(implemented.map(({ tax_id }) => tax_id), ["adverse-drug-reaction-contribution", "infection-contribution"]);
  assert.equal(manual.length, 12);
  assert.equal(new Set([...implemented, ...manual].map(({ tax_id }) => tax_id)).size, 14);
  assert.ok(manual.every(({ official_source_url, value_scope, evidence_gap, release_conditions }) => official_source_url.startsWith("https://") && value_scope.length >= 20 && evidence_gap.length >= 20 && release_conditions.length >= 2));
  assert.ok(manual.every(({ value_scope }) => /単一値として集計しない|合算しない|統合しない/.test(value_scope)));
});

test("PMDA contribution rates, notification formulas, and fiscal periods reproduce offline", async () => {
  const plan = await publicPlan();
  const cases = [
    { sourceId: "pmda-adverse-reaction-contribution-2026", taxId: "adverse-drug-reaction-contribution", rate: 0.27, formula: "1/4" },
    { sourceId: "pmda-infection-contribution-2026", taxId: "infection-contribution", rate: 0.05, formula: "1/3" }
  ];
  for (const { sourceId, taxId, rate, formula } of cases) {
    const result = await runSourcePipeline({ root, sourceId, fetchImpl: fixtureFetch, now, dryRun: true });
    assert.equal(result.status, "no_change");
    const target = plan.implemented_targets.find(({ tax_id }) => tax_id === taxId);
    assert.deepEqual(target.components.map(({ period_start, period_end }) => [period_start, period_end]), [["2026-04-01", "2027-03-31"], ["2026-04-01", "2027-03-31"]]);
    assert.equal(target.components[0].numeric_value, rate);
    assert.match(target.components[1].formula_raw, new RegExp(formula.replace("/", "\\/")));
    assert.equal(target.components[0].included_in_total, false);
    assert.equal(target.components[1].included_in_total, false);
  }
});

test("PMDA shared legal family never distributes one contribution's facts to another", async () => {
  const adverse = await runSourcePipeline({ root, sourceId: "pmda-adverse-reaction-contribution-2026", fetchImpl: fixtureFetch, now, dryRun: true });
  const infection = await runSourcePipeline({ root, sourceId: "pmda-infection-contribution-2026", fetchImpl: fixtureFetch, now, dryRun: true });
  assert.ok(adverse.normalized.facts.every(({ fact_id }) => fact_id.startsWith("adverse-")));
  assert.ok(infection.normalized.facts.every(({ fact_id }) => fact_id.startsWith("infection-")));
  await assert.rejects(runSourcePipeline({
    root, sourceId: "pmda-adverse-reaction-contribution-2026", now, dryRun: true,
    fetchImpl: async () => fixtureFetch("https://www.pmda.go.jp/files/000281003.pdf")
  }), /adverse reaction general rate was not found/);
  await assert.rejects(runSourcePipeline({
    root, sourceId: "pmda-infection-contribution-2026", now, dryRun: true,
    fetchImpl: async () => fixtureFetch("https://www.pmda.go.jp/files/000281001.pdf")
  }), /infection general rate was not found/);
});

test("Issue 59 targets have one official annual value or actionable manual metadata", async () => {
  const plan = await publicPlan();
  const issue59 = new Set(["asbestos-relief-general-contribution","asbestos-relief-special-contribution","child-care-contribution","east-japan-business-rehabilitation-contribution","hepatitis-c-special-relief-contribution","minamata-specified-business-compensation-levy","nuclear-damage-support-general-charge","nuclear-damage-support-special-charge","nuclear-decommissioning-contribution","postal-network-support-contribution","regional-economy-revitalization-contribution","renewable-energy-surcharge","reprocessing-contribution","taxi-center-business-charge"]);
  const implemented = plan.implemented_targets.filter(({ tax_id }) => issue59.has(tax_id));
  const manual = plan.manual_targets.filter(({ tax_id }) => issue59.has(tax_id));
  assert.deepEqual(implemented.map(({ tax_id }) => tax_id), ["child-care-contribution"]);
  assert.equal(manual.length, 13);
  assert.equal(new Set([...implemented, ...manual].map(({ tax_id }) => tax_id)).size, 14);
  assert.ok(manual.every(({ official_source_url, value_scope, evidence_gap, release_conditions, recheck_cadence }) => official_source_url.startsWith("https://") && value_scope.length >= 20 && evidence_gap.length >= 20 && release_conditions.length >= 2 && recheck_cadence === "annual"));
  assert.ok(manual.every(({ value_scope }) => /単一値として集計しない|合算しない/.test(value_scope)));
});

test("Issue 59 child-care annual value and period reproduce offline without conflation", async () => {
  const plan = await publicPlan();
  const child = await runSourcePipeline({ root, sourceId: "cfa-child-care-contribution-2026", fetchImpl: fixtureFetch, now, dryRun: true });
  assert.equal(child.status, "no_change");
  const childFacts = new Map(child.normalized.facts.map(({ fact_id, value }) => [fact_id, value]));
  assert.deepEqual([...childFacts.values()], ["2026-04-01", "2027-03-31", 0.36]);
  const childComponent = plan.implemented_targets.find(({ tax_id }) => tax_id === "child-care-contribution").components[0];
  assert.equal(childComponent.liable_party_role, "employer");
  assert.equal(childComponent.numeric_value, 0.36);
  assert.equal(childComponent.unit, "percent");
  assert.doesNotMatch(childComponent.subject_scope, /支援金/);
});

test("Issue 59 child-care annual changes are detected and missing period markers fail closed", async () => {
  const changedChild = await runSourcePipeline({
    root, sourceId: "cfa-child-care-contribution-2026", now, dryRun: true,
    fetchImpl: async (url) => new Response((await (await fixtureFetch(url)).text()).replace("0.36％", "0.37％"), { status: 200, headers: { "content-type": "text/html" } })
  });
  assert.deepEqual(changedChild.candidate_diff.map(({ fact_id, current, candidate }) => ({ fact_id, current, candidate })), [{ fact_id: "child-care-contribution-rate", current: 0.36, candidate: 0.37 }]);
  await assert.rejects(runSourcePipeline({
    root, sourceId: "cfa-child-care-contribution-2026", now, dryRun: true,
    fetchImpl: async (url) => new Response((await (await fixtureFetch(url)).text()).replaceAll("令和8年度", "年度未確認"), { status: 200, headers: { "content-type": "text/html" } })
  }), /child-care-period-start was not found/);
});

test("Issue 60 separates pre-enforcement, active conditional, and active annual-value states", async () => {
  const plan = await publicPlan();
  const issue60 = new Set(["fossil-fuel-levy","gx-specified-business-charge","supplementary-nuclear-damage-general-charge","supplementary-nuclear-damage-special-charge","telephone-accessibility-charge"]);
  const implemented = plan.implemented_targets.filter(({ tax_id }) => issue60.has(tax_id));
  const manual = plan.manual_targets.filter(({ tax_id }) => issue60.has(tax_id));
  assert.deepEqual(implemented.map(({ tax_id }) => tax_id), ["telephone-accessibility-charge"]);
  assert.equal(manual.length, 4);
  assert.equal(new Set([...implemented, ...manual].map(({ tax_id }) => tax_id)).size, 5);
  const byId = new Map([...implemented, ...manual].map((target) => [target.tax_id, target]));
  assert.equal(byId.get("fossil-fuel-levy").lifecycle.current_state, "pre_enforcement");
  assert.equal(byId.get("fossil-fuel-levy").lifecycle.collection_start.value, "2028-04-01");
  assert.equal(byId.get("fossil-fuel-levy").lifecycle.collection_start.precision, "fiscal_year");
  assert.equal(byId.get("gx-specified-business-charge").lifecycle.collection_start.value, "2033-04-01");
  assert.equal(byId.get("supplementary-nuclear-damage-general-charge").lifecycle.current_state, "active_individual_decision");
  assert.equal(byId.get("supplementary-nuclear-damage-special-charge").lifecycle.current_state, "active_conditional");
  assert.equal(byId.get("telephone-accessibility-charge").lifecycle.current_state, "active_official_value");
  assert.ok([...implemented, ...manual].every(({ lifecycle }) => lifecycle && lifecycle.promulgation.raw && lifecycle.enforcement.raw && lifecycle.application_start.raw && lifecycle.collection_start.raw && lifecycle.release_events.length > 0));
});

test("Issue 60 telephone relay annual price reproduces offline and changes fail closed", async () => {
  const plan = await publicPlan();
  const result = await runSourcePipeline({ root, sourceId: "tca-telephone-relay-number-price-2026", fetchImpl: fixtureFetch, now, dryRun: true });
  assert.equal(result.status, "no_change");
  assert.deepEqual(result.normalized.facts.map(({ value }) => value), ["2026-04-01", "2027-03-31", 1]);
  const component = plan.implemented_targets.find(({ tax_id }) => tax_id === "telephone-accessibility-charge").components[0];
  assert.equal(component.numeric_value, 1);
  assert.equal(component.unit, "yen_per_number_month");
  assert.equal(component.included_in_total, false);
  await assert.rejects(runSourcePipeline({
    root, sourceId: "tca-telephone-relay-number-price-2026", now, dryRun: true,
    fetchImpl: async (url) => new Response((await (await fixtureFetch(url)).text()).replaceAll("1円", "2円"), { status: 200, headers: { "content-type": "text/html" } })
  }), /twelve monthly prices was not found/);
});

test("disability employment levy amount is reproducible offline", async () => {
  const plan = await publicPlan();
  const result = await runSourcePipeline({ root, sourceId: "jeed-disability-employment-levy", fetchImpl: fixtureFetch, now, dryRun: true });
  assert.equal(result.status, "no_change");
  assert.match(result.fetches[0].sha256, /^[a-f0-9]{64}$/);
  const component = plan.implemented_targets.find(({ tax_id: taxId }) => taxId === "disability-employment-levy").components[0];
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
