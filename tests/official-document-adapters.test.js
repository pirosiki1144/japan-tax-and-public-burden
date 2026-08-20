import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { adaptCsvDocument, adaptHtmlDocument, adaptPdfDocument } from "../scripts/formats/official-document.js";
import { extractCsvFacts, extractTextFacts } from "../scripts/normalize/declarative-document-facts.js";

const fixtureRoot = new URL("fixtures/format-adapters/", import.meta.url);
const fetchedAt = "2026-08-21T12:00:00+09:00";

async function page(name, contentType) {
  const bytes = new Uint8Array(await readFile(new URL(name, fixtureRoot)));
  return {
    source_url: `https://example.go.jp/${name}`,
    final_url: `https://example.go.jp/${name}`,
    fetched_at: fetchedAt,
    content_type: contentType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes
  };
}

test("HTML format validation is separate from declarative semantic extraction", async () => {
  const document = await adaptHtmlDocument(await page("sample.html", "text/html; charset=UTF-8"), { documentVersion: "令和8年度" });
  assert.equal(document.title, "公式制度資料");
  assert.equal(document.evidence.document_version, "令和8年度");
  assert.match(document.evidence.raw_sha256, /^[a-f0-9]{64}$/);
  const normalized = extractTextFacts(document, {
    required_markers: [{ label: "対象者", pattern: "対象者は事業者" }],
    facts: [{ fact_id: "rate", pattern: "税率は([0-9]+)パーセント", transform: "number" }]
  });
  assert.deepEqual(normalized.facts.map(({ fact_id, value }) => ({ fact_id, value })), [{ fact_id: "rate", value: 10 }]);
});

test("PDF adapter extracts readable pages and preserves raw evidence", async () => {
  const document = await adaptPdfDocument(await page("sample.pdf", "application/pdf"), { documentVersion: "2026-08" });
  assert.equal(document.page_count, 1);
  assert.match(document.text, /Official rate is 10 percent/);
  assert.equal(document.evidence.source_url, "https://example.go.jp/sample.pdf");
  assert.equal(extractTextFacts(document, { facts: [{ fact_id: "rate", pattern: "rate is ([0-9]+) percent", transform: "number" }] }).facts[0].value, 10);
});

test("CSV adapter validates headers and requires exactly one semantic match", async () => {
  const document = await adaptCsvDocument(await page("sample.csv", "text/csv; charset=UTF-8"), {
    documentVersion: "令和8年度", requiredHeaders: ["制度", "対象者", "税率", "資料版"]
  });
  assert.equal(document.records.length, 2);
  const normalized = extractCsvFacts(document, {
    facts: [{ fact_id: "standard-rate", match: { 制度: "標準制度" }, value_column: "税率", transform: "number" }]
  });
  assert.equal(normalized.facts[0].value, 10000);
  assert.throws(() => extractCsvFacts(document, {
    facts: [{ fact_id: "ambiguous", match: { 資料版: "令和8年度" }, value_column: "税率", transform: "number" }]
  }), /matched 2 CSV rows/);
});

test("format adapters fail closed for unreadable or structurally changed input", async () => {
  await assert.rejects(adaptHtmlDocument({ ...(await page("sample.html", "text/html")), bytes: new Uint8Array() }), /no readable text/);
  await assert.rejects(adaptPdfDocument({ ...(await page("sample.pdf", "application/pdf")), bytes: new TextEncoder().encode("not pdf") }), /signature is missing/);
  await assert.rejects(adaptCsvDocument(await page("sample.csv", "text/csv"), { requiredHeaders: ["不存在"] }), /headers are missing/);
  const html = await adaptHtmlDocument(await page("sample.html", "text/html"));
  assert.throws(() => extractTextFacts(html, { required_markers: [{ label: "missing marker", pattern: "存在しない" }] }), /missing marker was not found/);
});
