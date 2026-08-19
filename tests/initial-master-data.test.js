import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildInitialMasterBurdens } from "../scripts/initial-master/build-burdens.js";
import { buildInitialMasterSelection } from "../scripts/generate/initial-master-selection.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("all selected initial-master records are registered reproducibly", async () => {
  const expected = await buildInitialMasterBurdens(root);
  const tracked = JSON.parse(await readFile(new URL("../data/burdens/initial-master.json", import.meta.url), "utf8"));
  const selection = await buildInitialMasterSelection(root);

  assert.deepEqual(tracked, expected);
  assert.equal(tracked.length, 111);
  assert.equal(new Set(tracked.map(({ tax_id }) => tax_id)).size, 111);
  assert.deepEqual(selection.counts, {
    candidates: 119, insert: 111, merge_existing: 1, hold: 7, excluded: 0, law_source_found: 112, law_source_not_found: 7
  });
});

test("initial-master records preserve four-state status and evidence gaps", async () => {
  const burdens = await buildInitialMasterBurdens(root);
  for (const burden of burdens) {
    assert.ok(["not_applied", "active", "active_with_pending_change", "ended"].includes(burden.current_status), burden.tax_id);
    assert.ok(burden.legal_bases.length > 0, burden.tax_id);
    assert.ok(burden.legal_bases.every(({ law_id, source_url }) => law_id && source_url.endsWith(law_id)), burden.tax_id);
    assert.deepEqual(burden.source_refs, ["egov-laws"]);
    assert.deepEqual(burden.current_phases, []);
    assert.deepEqual(burden.pending_changes, []);
    assert.ok(burden.evidence_gaps.some((gap) => gap.includes("公布日")), burden.tax_id);
  }
});

test("held candidates and the existing consumption-tax record are not duplicated", async () => {
  const burdens = await buildInitialMasterBurdens(root);
  const ids = new Set(burdens.map(({ tax_id }) => tax_id));

  assert.equal(ids.has("consumption-tax"), false);
  assert.equal(ids.has("defense-special-income-tax"), false);
  assert.equal(ids.has("financial-adr-charge"), false);
});
