import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildCalculatedComponentCandidates, buildDecisionViews, formatAdapterRegistry, loadMonitoringRegistry } from "../scripts/monitoring/monitoring-registry.js";

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
    assert.ok(decision.source_ids.length > 0);
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
  assert.doesNotMatch(JSON.stringify(registry), /https?:\/\//);
});

test("one manifest owns adapters, canonical targets, and bounded calculation policies", async () => {
  const registry = await loadMonitoringRegistry(root);
  assert.deepEqual(formatAdapterRegistry(registry).map(({ format }) => format).sort(), ["csv", "html", "pdf", "spreadsheet"]);
  assert.equal(new Set(registry.targets.map(({ monitoring_target_id }) => monitoring_target_id)).size, 112);
  assert.ok(registry.targets.every(({ public_burden_id, tax_id, canonical_target }) => public_burden_id === tax_id && (canonical_target.source_fact_ids?.length || canonical_target.legal_state_id)));
  assert.deepEqual(Object.keys(registry.calculation_policies).sort(), ["equal_split", "explicit_allocation"]);
});

test("pension shares are candidates from a direct fact and equal_split without a free expression", async () => {
  const registry = await loadMonitoringRegistry(root);
  const candidates = buildCalculatedComponentCandidates(registry, {
    policyId: "equal_split", sourceFactId: "employees-pension-total-rate", normalizedValue: 18.3,
    outputComponentIds: ["employees-pension-insured", "employees-pension-employer"]
  });
  assert.deepEqual(candidates.map(({ numeric_value }) => numeric_value), [9.15, 9.15]);
  assert.ok(candidates.every(({ acquisition_type, input_source_fact_ids, rounding }) => acquisition_type === "calculated" && input_source_fact_ids[0] === "employees-pension-total-rate" && rounding === "none"));
  assert.throws(() => buildCalculatedComponentCandidates(registry, { policyId: "value / 2", sourceFactId: "x", normalizedValue: 18.3, outputComponentIds: ["a", "b"] }), /Unknown calculation policy/);
});
