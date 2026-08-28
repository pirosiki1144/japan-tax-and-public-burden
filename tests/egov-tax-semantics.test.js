import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractConfiguredSemantics } from "../scripts/monitoring/extract-egov-tax-semantics.js";
import { buildDecisionViews, loadMonitoringRegistry } from "../scripts/monitoring/monitoring-registry.js";
import { diffSemanticValues, extractConfiguredLocalTaxSemantics, extractEgovTaxSemantics, extractGenericNationalTaxSemantics } from "../scripts/normalize/egov-tax-semantics.js";
import { readYaml } from "../scripts/validate/schema-validator.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = join(root, "tests/fixtures/source-scan");
const localPlan = async () => buildDecisionViews(await loadMonitoringRegistry(root))["local-tax-adapters"];

async function fixture(name) {
  return JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
}

function findNode(node, tag, number) {
  if (!node || typeof node !== "object") return null;
  if (node.tag === tag && (number === undefined || node.attr?.Num === number)) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, tag, number);
    if (found) return found;
  }
  return null;
}

test("fixtures extract reviewable taxpayers, tax bases, and rates deterministically", async () => {
  const first = await extractConfiguredSemantics(root, { fixtureDir });
  const second = await extractConfiguredSemantics(root, { fixtureDir });
  assert.equal(`${JSON.stringify(first, null, 2)}\n`, `${JSON.stringify(second, null, 2)}\n`);

  const consumption = first.records.find(({ tax_id }) => tax_id === "consumption-tax");
  assert.deepEqual(consumption.rates.map(({ rate_type, value }) => ({ rate_type, value })), [
    { rate_type: "standard", value: 7.8 },
    { rate_type: "reduced", value: 6.24 }
  ]);
  assert.deepEqual(consumption.taxpayer_rules.map(({ role }) => role), ["business_operator", "bonded_goods_withdrawer"]);
  assert.equal(consumption.tax_base_rules.length, 2);

  const automobile = first.records.find(({ tax_id }) => tax_id === "automobile-tax");
  assert.deepEqual(automobile.taxpayer_rules.map(({ role }) => role), ["owner", "user_when_owner_exempt"]);
  assert.deepEqual(automobile.rates.map(({ amount_yen }) => amount_yen), [7500, 25000, 6500]);
  assert.ok(first.records.every(({ law_id, revision_id, updated_at, source_url }) => law_id && revision_id && updated_at && source_url.startsWith("https://")));
});

test("a semantic rate change reports an item-level old and new value", async () => {
  const document = await fixture("363AC0000000108");
  const original = extractEgovTaxSemantics(document, "consumption-tax", "https://example.invalid/law");
  const changedDocument = structuredClone(document);
  const item = findNode(changedDocument.law_full_text, "Item", "1");
  item.children = ["課税資産の譲渡等　百分の七・九"];
  const changed = extractEgovTaxSemantics(changedDocument, "consumption-tax", "https://example.invalid/law");
  const diff = diffSemanticValues(original, changed);
  assert.ok(diff.some(({ path, old_value, new_value }) => path === "rates[0].value" && old_value === 7.8 && new_value === 7.9));
});

test("missing, duplicate, and unreadable legal structures fail closed", async () => {
  const consumption = await fixture("363AC0000000108");
  const main = findNode(consumption.law_full_text, "MainProvision");
  main.children = main.children.filter((node) => node.attr?.Num !== "5");
  assert.throws(() => extractEgovTaxSemantics(consumption, "consumption-tax", "https://example.invalid/law"), /Article 5 matched 0/);

  const duplicate = await fixture("363AC0000000108");
  const duplicateMain = findNode(duplicate.law_full_text, "MainProvision");
  duplicateMain.children.push(structuredClone(findNode(duplicate.law_full_text, "Article", "29")));
  assert.throws(() => extractEgovTaxSemantics(duplicate, "consumption-tax", "https://example.invalid/law"), /Article 29 matched 2/);

  const automobile = await fixture("325AC0000000226");
  const tableRow = findNode(automobile.law_full_text, "TableRow");
  tableRow.children[0].children = ["分類不能"];
  assert.throws(() => extractEgovTaxSemantics(automobile, "automobile-tax", "https://example.invalid/law"), /heading is unreadable/);
});

test("the common national-tax adapter extracts reviewable legal meanings", async () => {
  const document = await fixture("347AC0000000007");
  const record = extractGenericNationalTaxSemantics(document, "aviation-fuel-tax", "https://example.invalid/law");
  assert.equal(record.taxpayer_rules[0].article_num, "4");
  assert.equal(record.taxable_scope_rules[0].article_num, "3");
  assert.equal(record.tax_base_rules[0].article_num, "10");
  assert.match(record.rates[0].raw, /二万六千円/);
  assert.equal(record.applicable_period.amendment_enforcement_date, document.revision_info.amendment_enforcement_date);
});

test("common national-tax value and structure changes are detected offline", async () => {
  const document = await fixture("347AC0000000007");
  const original = extractGenericNationalTaxSemantics(document, "aviation-fuel-tax", "https://example.invalid/law");
  const changed = JSON.parse(JSON.stringify(document).replace("二万六千円", "二万七千円"));
  const changedRecord = extractGenericNationalTaxSemantics(changed, "aviation-fuel-tax", "https://example.invalid/law");
  assert.ok(diffSemanticValues(original, changedRecord).some(({ path }) => path === "rates[0].raw"));

  const broken = structuredClone(document);
  const main = findNode(broken.law_full_text, "MainProvision");
  main.children = main.children.filter(({ attr }) => attr?.Num !== "11");
  assert.throws(() => extractGenericNationalTaxSemantics(broken, "aviation-fuel-tax", "https://example.invalid/law"), /rates matched 0/);
});

test("local-tax selectors retain national-law scope and exclude municipal actual values", async () => {
  const [document, config] = await Promise.all([fixture("325AC0000000226"), localPlan()]);
  const profile = config.targets.find(({ tax_id }) => tax_id === "fixed-asset-tax");
  const record = extractConfiguredLocalTaxSemantics(document, profile.tax_id, "https://example.invalid/law", profile);
  assert.deepEqual(record.taxpayer_rules.map(({ article_num }) => article_num), ["343"]);
  assert.deepEqual(record.taxable_scope_rules.map(({ article_num }) => article_num), ["342"]);
  assert.deepEqual(record.rates.map(({ article_num }) => article_num), ["350"]);
  assert.equal(record.value_scope, "national_law_standard_or_limit");
  assert.equal(record.municipal_actual_value_included, false);
});

test("a missing configured local-tax article fails closed", async () => {
  const [document, config] = await Promise.all([fixture("325AC0000000226"), localPlan()]);
  const profile = config.targets.find(({ tax_id }) => tax_id === "bathing-tax");
  const main = findNode(document.law_full_text, "MainProvision");
  main.children = main.children.filter(({ attr }) => attr?.Num !== "701_2");
  assert.throws(() => extractConfiguredLocalTaxSemantics(document, profile.tax_id, "https://example.invalid/law", profile), /Article 701_2 matched 0/);
});
