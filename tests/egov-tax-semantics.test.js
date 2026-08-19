import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractConfiguredSemantics } from "../scripts/monitoring/extract-egov-tax-semantics.js";
import { diffSemanticValues, extractEgovTaxSemantics } from "../scripts/normalize/egov-tax-semantics.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = join(root, "tests/fixtures/source-scan");

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
