import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildExtractionTargetReview, buildRuntimeMonitoringPlan } from "../scripts/monitoring/build-monitoring-config.js";
import { buildEgovChangeSnapshot, hasEgovSourceChanged } from "../scripts/monitoring/egov-change-detection.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every canonical burden has one reproducible monitoring decision", async () => {
  const runtime = await buildRuntimeMonitoringPlan(root);
  assert.equal(runtime.targets.length, 112);
  assert.equal(new Set(runtime.targets.map(({ tax_id }) => tax_id)).size, 112);
});

test("automation is enabled only where an adapter and extraction targets exist", async () => {
  const { targets } = await buildRuntimeMonitoringPlan(root);
  const automated = targets.filter(({ monitoring_mode }) => monitoring_mode === "automated");
  const manual = targets.filter(({ monitoring_mode }) => monitoring_mode === "manual");

  assert.deepEqual(automated.map(({ tax_id }) => tax_id), ["adverse-drug-reaction-contribution", "child-care-contribution", "consumption-tax", "disability-employment-levy", "educational-public-transmission-compensation", "employment-insurance-premium", "infection-contribution", "pension-insurance-premium", "telephone-accessibility-charge", "universal-service-fee"]);
  assert.equal(manual.length, 102);
  assert.ok(automated.every(({ sources }) => sources.length > 1));
  assert.ok(automated.find(({ tax_id }) => tax_id === "employment-insurance-premium").sources.some(({ adapter }) => adapter === "pdf_regex_facts"));
  assert.ok(targets.every(({ sources }) => sources.every(({ target_url, extraction_targets }) => target_url.startsWith("https://") && extraction_targets.length > 0)));
});

test("multiple law sources and municipal scope remain explicit", async () => {
  const { targets } = await buildRuntimeMonitoringPlan(root);
  const byId = new Map(targets.map((target) => [target.tax_id, target]));

  assert.equal(byId.get("medical-insurance-premium").sources.length, 3);
  assert.equal(byId.get("local-consumption-tax").municipal_scope, "issue_20");
  assert.match(byId.get("local-consumption-tax").notes, /#20/);
});

test("reviewed extraction targets have official links and concrete checkboxes", async () => {
  const review = await buildExtractionTargetReview(root);
  const tracked = await readFile(new URL("../docs/monitoring-extraction-target-review.md", import.meta.url), "utf8");

  assert.equal(tracked, review);
  assert.equal((review.match(/^## /gm) ?? []).length, 2);
  assert.equal((review.match(/^参照先: \[.+\]\(https:\/\/.+\)$/gm) ?? []).length, 4);
  assert.ok(review.includes("- [x] 消費税法第28条・第29条：課税標準、消費税率（`MainProvision > Article.attr.Num` = `28`, `29`）"));
  assert.ok(review.includes("- [x] 地方税法第154条：車種・用途・排気量等ごとの標準税率（`MainProvision > Article.attr.Num` = `154`）"));
});

test("e-Gov configuration produces machine-readable change snapshots", async () => {
  const { targets } = await buildRuntimeMonitoringPlan(root);
  const source = targets.find(({ tax_id }) => tax_id === "automobile-tax").sources[0];
  const article = (num, text) => ({ tag: "Article", attr: { Num: num }, children: [text] });
  const document = {
    revision_info: { law_revision_id: "revision-1", updated: "2026-08-19T00:00:00+09:00" },
    law_full_text: { tag: "Law", attr: {}, children: [{ tag: "MainProvision", attr: {}, children: ["145", "146", "147", "148", "154", "155", "156", "157", "158"].map((num) => article(num, `article-${num}`)) }] }
  };
  const original = buildEgovChangeSnapshot(document, source);
  const repeated = buildEgovChangeSnapshot(structuredClone(document), source);
  assert.equal(hasEgovSourceChanged(original, repeated), false);

  const changedDocument = structuredClone(document);
  changedDocument.law_full_text.children[0].children.find(({ attr }) => attr.Num === "154").children = ["updated-rate"];
  const changed = buildEgovChangeSnapshot(changedDocument, source);
  assert.equal(hasEgovSourceChanged(original, changed), true);
});
