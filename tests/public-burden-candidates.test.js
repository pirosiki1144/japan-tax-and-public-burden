import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readYaml } from "../scripts/validate/schema-validator.js";

const questionPath = fileURLToPath(new URL("../data/candidates/public-burdens-question-39.yaml", import.meta.url));
const additionsPath = fileURLToPath(new URL("../data/candidates/public-burdens-government-additions.yaml", import.meta.url));

const OFFICIAL_SOURCE_PREFIX = "https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/";

test("question 39 and government answer additions are collected without duplicate IDs", async () => {
  const questionCandidates = await readYaml(questionPath);
  const additionCandidates = await readYaml(additionsPath);
  const candidates = [...questionCandidates, ...additionCandidates];

  assert.equal(questionCandidates.length, 39);
  assert.equal(additionCandidates.length, 31);
  assert.equal(candidates.length, 70);
  assert.equal(new Set(candidates.map(({ candidate_id }) => candidate_id)).size, 70);
});

test("public-burden candidates remain distinct from national and local taxes", async () => {
  const candidates = [...await readYaml(questionPath), ...await readYaml(additionsPath)];

  for (const candidate of candidates) {
    assert.notEqual(candidate.burden_type, "national_tax", candidate.candidate_id);
    assert.notEqual(candidate.burden_type, "local_tax", candidate.candidate_id);
    assert.equal(candidate.current_status, null, candidate.candidate_id);
    assert.match(candidate.verified_at, /^2026-08-18T/, candidate.candidate_id);
    assert.ok(candidate.source_urls.every((url) => url.startsWith(OFFICIAL_SOURCE_PREFIX)), candidate.candidate_id);
    assert.ok(candidate.responsible_authorities.length > 0, candidate.candidate_id);
    assert.ok(candidate.legal_basis_notes.length > 0, candidate.candidate_id);
    assert.ok(candidate.evidence_gaps.length > 0, candidate.candidate_id);
  }
});

test("ambiguous and private-rule examples retain their review distinctions", async () => {
  const questionCandidates = await readYaml(questionPath);
  const byId = new Map(questionCandidates.map((candidate) => [candidate.candidate_id, candidate]));

  assert.equal(byId.get("nonlife-insurance-rate-organization-charge").legal_mandate_type, "contractual_or_private_rule");
  assert.equal(byId.get("port-transport-business-contribution").legal_mandate_type, "contractual_or_private_rule");
  assert.equal(byId.get("fossil-fuel-levy").coverage_status, "needs_review");
  assert.match(byId.get("fossil-fuel-levy").evidence_gaps.join(" "), /徴収開始/);
});

test("government additions retain answer provenance and are not presented as exhaustive", async () => {
  const candidates = await readYaml(additionsPath);

  assert.ok(candidates.every(({ source_urls }) => source_urls.some((url) => url.endsWith("/touh/t212073.htm"))));
  assert.ok(candidates.every(({ decision_note }) => decision_note.includes("追加例")));
});
