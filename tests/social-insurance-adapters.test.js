import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../scripts/validate/schema-validator.js";
import { runSourcePipeline } from "../scripts/pipeline/source-pipeline.js";
import { buildDecisionProjections, loadMonitoringManifest } from "../scripts/monitoring/monitoring-manifest.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(root, "tests/fixtures/source-scan");
const now = () => new Date("2026-08-21T06:34:11+09:00");
const socialPlan = async () => buildDecisionProjections(await loadMonitoringManifest(root))["social-insurance-adapters"];

async function fixtureFetch(url) {
  const name = basename(new URL(url).pathname);
  const body = await readFile(join(fixtureRoot, name));
  const contentType = name.endsWith(".pdf") ? "application/pdf" : "text/html; charset=UTF-8";
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

test("all five social-insurance targets are implemented or have a concrete hold reason", async () => {
  const [registry, sources, inventory] = await Promise.all([
    socialPlan(),
    readYaml(new URL("../config/sources.yaml", import.meta.url)),
    readYaml(new URL("../config/adapter-inventory.yaml", import.meta.url))
  ]);
  assert.equal(registry.targets.length, 5);
  assert.deepEqual(registry.targets.filter(({ status }) => status === "implemented").map(({ tax_id }) => tax_id).sort(), ["employment-insurance-premium", "pension-insurance-premium"]);
  assert.ok(registry.targets.filter(({ status }) => status === "held").every(({ hold_reason }) => hold_reason.length >= 20));
  for (const target of registry.targets.filter(({ status }) => status === "implemented")) {
    assert.equal(target.government_contribution_handling, "excluded_from_premium_total");
    assert.ok(target.source_ids.every((sourceId) => sources.sources.some(({ source_id, automation_enabled: enabled }) => source_id === sourceId && enabled)));
  }
  const inventoried = inventory.targets.filter(({ implementation_issue }) => implementation_issue === 44);
  assert.equal(inventoried.filter(({ implementation_status }) => implementation_status === "implemented").length, 2);
  assert.equal(inventoried.filter(({ implementation_status }) => implementation_status === "held").length, 3);
});

test("contribution totals and payer parts cannot be double-counted", async () => {
  const registry = await socialPlan();
  for (const target of registry.targets.filter(({ status }) => status === "implemented")) {
    const byScope = Map.groupBy(target.components, ({ scope }) => scope);
    for (const components of byScope.values()) {
      const total = components.find(({ aggregation_role }) => aggregation_role === "total");
      const parts = components.filter(({ aggregation_role }) => aggregation_role === "part");
      if (!total) {
        assert.ok(components.every(({ aggregation_role, included_in_total }) => aggregation_role === "standalone" && !included_in_total));
        continue;
      }
      assert.equal(total.included_in_total, false);
      assert.ok(parts.every(({ included_in_total }) => included_in_total));
      assert.equal(parts.reduce((sum, { numeric_value }) => sum + numeric_value, 0), total.numeric_value);
      assert.equal(new Set([total, ...parts].map(({ unit }) => unit)).size, 1);
      assert.equal(new Set([total, ...parts].map(({ period_start }) => period_start)).size, 1);
    }
  }
});

test("pension and employment values are reproducible with offline official-format fixtures", async () => {
  const registry = await socialPlan();
  for (const sourceId of ["mhlw-employment-insurance-rates", "nenkin-pension-premiums"]) {
    const result = await runSourcePipeline({ root, sourceId, fetchImpl: fixtureFetch, now, dryRun: true });
    assert.equal(result.status, "no_change");
    assert.ok(result.fetches.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
    const facts = new Map(result.normalized.facts.map(({ fact_id, value }) => [fact_id, typeof value === "string" ? Number(value.replaceAll(",", "")) : value]));
    const components = registry.targets.flatMap(({ components = [] }) => components).filter(({ source_id, value_status }) => source_id === sourceId && value_status === "official_current");
    assert.ok(components.every(({ fact_id, numeric_value }) => facts.get(fact_id) === numeric_value));
    if (sourceId === "mhlw-employment-insurance-rates") {
      const employment = registry.targets.find(({ tax_id }) => tax_id === "employment-insurance-premium");
      assert.deepEqual(employment.period_fact_ids.map((factId) => result.normalized.facts.find(({ fact_id }) => fact_id === factId).value), ["2026-04-01", "2027-03-31"]);
      assert.ok(employment.components.every(({ period_start, period_end }) => period_start === "2026-04-01" && period_end === "2027-03-31"));
    }
  }
});

test("rate changes and missing structures fail closed without canonical writes", async () => {
  const changedFetch = async (url) => {
    const response = await fixtureFetch(url);
    if (!url.endsWith("20150331.html")) return response;
    return new Response((await response.text()).replace("17,920", "17,930"), { status: 200, headers: { "content-type": "text/html" } });
  };
  const changed = await runSourcePipeline({ root, sourceId: "nenkin-pension-premiums", fetchImpl: changedFetch, now, dryRun: true });
  assert.equal(changed.status, "change_detected");
  assert.deepEqual(changed.candidate_diff.map(({ fact_id, current, candidate }) => ({ fact_id, current, candidate })), [
    { fact_id: "national-pension-monthly-amount", current: "17,920", candidate: "17,930" }
  ]);
  await assert.rejects(runSourcePipeline({
    root, sourceId: "nenkin-pension-premiums", now, dryRun: true,
    fetchImpl: async (url) => {
      const response = await fixtureFetch(url);
      return url.endsWith("20150515-01.html")
        ? new Response((await response.text()).replace("事業主と被保険者とが半分ずつ負担", "負担記述なし"), { status: 200, headers: { "content-type": "text/html" } })
        : response;
    }
  }), /shared burden was not found/);
});
