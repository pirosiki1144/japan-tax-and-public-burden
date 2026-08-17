import test from "node:test";
import assert from "node:assert/strict";
import { auditRepositoryCollections } from "../scripts/audit/repository-audit.js";

function collections() {
  return {
    burdens: [{ tax_id: "sample-tax", current_status: "active", current_phases: ["phase-a"], pending_changes: [] }],
    changes: [{ change_id: "sample-change", tax_ids: ["sample-tax"], events: ["sample-event"], promulgation_date: { date_value: "2020-01-01" }, enforcement_date: { date_value: "2020-02-01" }, application_start_dates: [{ date_value: "2020-03-01" }], collection_start_dates: [{ date_value: null }], source_refs: [] }],
    events: [{ event_id: "sample-event", change_id: "sample-change" }],
    phases: [{ phase_id: "phase-a", tax_id: "sample-tax", change_id: "sample-change", subject_scope: "same scope", application_start: "2020-03-01", application_end: null, collection_start: null }],
    revenues: []
  };
}

test("separate legal dates and main burden status pass when consistent", () => {
  assert.deepEqual(auditRepositoryCollections(collections(), { asOf: "2026-08-17" }), []);
});

test("date order, phase overlap, reference semantics, and state separation are audited", () => {
  const input = collections();
  input.changes[0].promulgation_date.date_value = "2020-04-01";
  input.phases.push({ ...input.phases[0], phase_id: "phase-b", application_start: "2020-04-01" });
  input.burdens[0].current_status = "ended";
  input.events[0].change_id = "another-change";
  const findings = auditRepositoryCollections(input, { asOf: "2026-08-17" });
  assert.ok(findings.some(({ code }) => code === "date_order_requires_review"));
  assert.ok(findings.some(({ code }) => code === "phase_period_overlap"));
  assert.ok(findings.some(({ code }) => code === "event_change_mismatch"));
  assert.ok(findings.some(({ code }) => code === "burden_status_mismatch"));
});

test("amount scope detects missing inner-total evidence and possible double counting", () => {
  const input = collections();
  const base = { tax_id: "sample-tax", period_start: "2025-04-01", period_end: "2026-03-31", amount_yen: "100", accounting_basis: "settlement", consolidation_scope: "national" };
  input.revenues = [
    { ...base, record_id: "inner", value_status: "included_in_parent_total", evidence_gap_reason: "" },
    { ...base, record_id: "first", value_status: "available", evidence_gap_reason: "" },
    { ...base, record_id: "second", value_status: "available", evidence_gap_reason: "" }
  ];
  const findings = auditRepositoryCollections(input, { asOf: "2026-08-17" });
  assert.ok(findings.some(({ code }) => code === "amount_scope_reason_missing"));
  assert.ok(findings.some(({ code }) => code === "possible_amount_double_count"));
});
