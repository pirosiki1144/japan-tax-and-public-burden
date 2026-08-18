import test from "node:test";
import assert from "node:assert/strict";
import { validateIntegrity } from "../scripts/validate/integrity-validator.js";

function validCollections() {
  return {
    sources: [{ source_id: "official-source" }],
    candidates: [{ candidate_id: "sample-candidate" }],
    burdens: [{ tax_id: "sample-tax", current_phases: ["sample-phase"], pending_changes: [], source_refs: ["official-source"] }],
    changes: [{ change_id: "sample-change", tax_ids: ["sample-tax"], events: ["sample-event"], source_refs: ["official-source"] }],
    events: [{ event_id: "sample-event", change_id: "sample-change" }],
    phases: [{ phase_id: "sample-phase", tax_id: "sample-tax", change_id: "sample-change", phase_sequence: 1, application_start: "2020-01-01", application_end: null, collection_start: null, collection_end: null, source_refs: ["official-source"] }],
    revenues: [],
    mappings: []
  };
}

test("valid cross-file references pass integrity validation", () => {
  assert.deepEqual(validateIntegrity(validCollections()), []);
});

test("duplicate IDs are rejected", () => {
  const collections = validCollections();
  collections.burdens.push({ ...collections.burdens[0] });
  assert.ok(validateIntegrity(collections).some((message) => message.includes("duplicate ID sample-tax")));
});

test("duplicate initial master candidate IDs are rejected", () => {
  const collections = validCollections();
  collections.candidates.push({ ...collections.candidates[0] });
  assert.ok(validateIntegrity(collections).some((message) => message.includes("duplicate ID sample-candidate")));
});

test("dangling references are rejected", () => {
  const collections = validCollections();
  collections.phases[0].source_refs = ["missing-source"];
  assert.ok(validateIntegrity(collections).some((message) => message.includes("unknown reference missing-source")));
});

test("reversed periods are rejected", () => {
  const collections = validCollections();
  collections.phases[0].application_end = "2019-12-31";
  assert.ok(validateIntegrity(collections).some((message) => message.includes("application_start must not be after application_end")));
});
