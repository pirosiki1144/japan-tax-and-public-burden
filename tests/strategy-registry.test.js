import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStrategyRegistry } from "../scripts/application/strategy-registry.js";
import { monitoringComposition } from "../scripts/composition/monitoring-composition.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("composition root registers every supported source, document, and semantic strategy once", () => {
  const { registries } = monitoringComposition();
  assert.deepEqual(registries.sourceReaders.names(), ["http"]);
  assert.deepEqual(registries.documentParsers.names(), ["official_csv_document", "official_html_document", "official_pdf_document"]);
  assert.deepEqual(registries.sourceNormalizers.names(), ["egov_law_article_facts", "html_regex_facts", "pdf_regex_facts"]);
  assert.deepEqual(registries.semanticExtractors.names(), ["egov_law_semantics"]);
});

test("strategy registry rejects duplicate, missing, and contract-invalid strategies", async () => {
  const registry = createStrategyRegistry("test strategy", (result, name) => {
    if (result?.ok !== true) throw new TypeError(`${name} returned an invalid result`);
  });
  registry.register("valid", async () => ({ ok: true }));
  assert.throws(() => registry.register("valid", async () => ({ ok: true })), /Duplicate test strategy/);
  assert.throws(() => registry.get("missing"), /No registered test strategy/);
  registry.register("invalid", async () => ({ ok: false }));
  await assert.rejects(registry.get("invalid")(), /invalid result/);
  assert.deepEqual(await registry.get("valid")(), { ok: true });
});

test("application modules do not import concrete I/O or parser implementations", async () => {
  for (const path of ["scripts/application/source-monitoring.js", "scripts/application/strategy-registry.js"]) {
    const source = await readFile(`${root}/${path}`, "utf8");
    assert.doesNotMatch(source, /node:|pdfjs-dist|\.\.\/fetch\/|\.\.\/formats\/|\.\.\/composition\//);
  }
});

test("every configured automated source resolves through the composed source normalizer registry", async () => {
  const { ports, registries } = monitoringComposition();
  const sources = await ports.sourceRepository.loadAutomated(root);
  assert.ok(sources.length > 0);
  assert.deepEqual([...new Set(sources.map(({ adapter }) => adapter).filter((name) => name !== "manual" && !registries.sourceNormalizers.has(name)))], []);
});
