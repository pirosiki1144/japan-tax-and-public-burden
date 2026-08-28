import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildDecisionViews, loadMonitoringRegistry } from "../scripts/monitoring/monitoring-registry.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("one canonical registry classifies all 112 monitoring targets", async () => {
  const registry = await loadMonitoringRegistry(root);
  assert.equal(registry.targets.length, 112);
  assert.equal(new Set(registry.targets.map(({ tax_id: taxId }) => taxId)).size, 112);
  assert.equal(registry.targets.filter(({ monitoring_mode: mode }) => mode === "automated").length, 10);
  assert.equal(registry.targets.filter(({ monitoring_mode: mode }) => mode === "manual").length, 102);
});

test("category decisions are deterministic in-memory projections", async () => {
  const projections = buildDecisionViews(await loadMonitoringRegistry(root));
  assert.equal(projections["national-tax-adapters"].targets.length, 23);
  assert.equal(projections["local-tax-adapters"].targets.length, 22);
  assert.equal(projections["social-insurance-adapters"].targets.length, 5);
  assert.equal(projections["public-burden-adapters"].implemented_targets.length, 7);
  assert.equal(projections["public-burden-adapters"].manual_targets.length, 53);
});

test("manual public burdens retain evidence gaps and release instructions", async () => {
  const registry = await loadMonitoringRegistry(root);
  const manual = registry.targets.filter(({ decision_kind: kind }) => kind === "public_manual");
  assert.equal(manual.length, 53);
  for (const { decision } of manual) {
    assert.ok(decision.official_source_url.startsWith("https://"));
    assert.ok(decision.evidence_gap.length > 0);
    assert.ok(decision.release_conditions.length > 0);
    assert.ok(decision.recheck_cadence.length > 0);
  }
});

test("monitoring registry does not duplicate crawl URL configuration", async () => {
  const registry = await loadMonitoringRegistry(root);
  for (const target of registry.targets) {
    assert.equal(Object.hasOwn(target.decision, "target_url"), false);
    assert.equal(Object.hasOwn(target.decision, "entry_urls"), false);
    assert.equal(Object.hasOwn(target.decision, "base_url"), false);
  }
});
