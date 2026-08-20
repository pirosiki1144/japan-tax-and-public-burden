import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnabledSource } from "../scripts/fetch/source-registry.js";
import { runAutomatedSources, runConfiguredSources, runSourcePipeline } from "../scripts/pipeline/source-pipeline.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(root, "tests/fixtures/source-scan");
const now = () => new Date("2026-08-17T01:02:03+09:00");

function fixtureFetch(transform = (body) => body) {
  return async (url) => {
    const name = basename(new URL(url).pathname);
    const bytes = await readFile(join(fixtureRoot, name));
    const body = name.endsWith(".pdf") ? bytes : transform(bytes.toString("utf8"), url);
    const contentType = name.endsWith(".pdf") ? "application/pdf" : body.trimStart().startsWith("{") ? "application/json" : "text/html; charset=UTF-8";
    return new Response(body, { status: 200, headers: { "content-type": contentType } });
  };
}

test("offline fixtures reproduce the canonical values without changing data", async () => {
  const canonicalPath = join(root, "data/phases/consumption-tax.yaml");
  const before = await readFile(canonicalPath, "utf8");
  const result = await runSourcePipeline({ root, sourceId: "nta-consumption-tax-rates", fetchImpl: fixtureFetch(), now, dryRun: true });
  assert.equal(result.status, "no_change");
  assert.equal(result.fetches.length, 2);
  assert.match(result.fetches[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.fetches.every(({ source_url, fetched_at }) => source_url.length > 0 && fetched_at === now().toISOString()));
  assert.equal(await readFile(canonicalPath, "utf8"), before);
});

test("a normalized value change creates a machine-readable candidate diff", async () => {
  const changed = fixtureFetch((body, url) => url.endsWith("6102.htm") ? body.replace("消費税率7.8", "消費税率7.9") : body);
  const result = await runSourcePipeline({ root, sourceId: "nta-consumption-tax-rates", fetchImpl: changed, now, dryRun: true });
  assert.equal(result.status, "change_detected");
  assert.equal(result.candidate_diff[0].fact_id, "standard-rate");
  assert.equal(result.candidate_diff[0].current, 7.8);
  assert.equal(result.candidate_diff[0].candidate, 7.9);
  assert.equal(result.candidate_diff[0].target.path, "value.numeric_value");
});

test("all configured automated sources run through one shared pipeline", async () => {
  const result = await runAutomatedSources({ root, fetchImpl: fixtureFetch(), now, dryRun: true });
  assert.equal(result.status, "no_change");
  assert.deepEqual(result.results.map(({ source_id }) => source_id), ["egov-laws", "nta-consumption-tax-rates", "mhlw-employment-insurance-rates", "nenkin-pension-premiums"]);
});

test("e-Gov fixtures confirm the statutory consumption-tax rates", async () => {
  const result = await runSourcePipeline({ root, sourceId: "egov-laws", fetchImpl: fixtureFetch(), now, dryRun: true });
  assert.equal(result.status, "no_change");
  assert.deepEqual(result.normalized.facts.map(({ fact_id, value }) => ({ fact_id, value })), [
    { fact_id: "consumption-tax-act-standard-rate", value: "百分の七・八" },
    { fact_id: "local-tax-act-local-consumption-ratio", value: "七十八分の二十二" }
  ]);
});

test("one source failure does not starve later sources and makes the aggregate fail", async () => {
  const source = await loadEnabledSource(root, "nta-consumption-tax-rates");
  const broken = { ...source, source_id: "broken-source", entry_urls: source.entry_urls.map((url) => url.replace(new URL(url).host, "broken.invalid")) };
  const fetchFromFixture = fixtureFetch();
  const fetchImpl = async (url) => new URL(url).host === "broken.invalid"
    ? new Response("failure", { status: 503 })
    : fetchFromFixture(url);
  const result = await runConfiguredSources({ root, sources: [broken, source], fetchImpl, now, dryRun: true });
  assert.equal(result.status, "error");
  assert.deepEqual(result.results.map(({ status }) => status), ["error", "no_change"]);
  assert.match(result.results[0].error, /Fetch failed \(503\)/);
});

test("structure failures retain fetched hashes for the audit trail", async () => {
  const source = await loadEnabledSource(root, "nta-consumption-tax-rates");
  const result = await runConfiguredSources({ root, sources: [source], fetchImpl: fixtureFetch((body) => body.replace("週2回以上発行", "")), now, dryRun: true });
  assert.equal(result.results[0].error_code, "source_structure_changed");
  assert.equal(result.results[0].fetches.length, 2);
  assert.ok(result.results[0].fetches.every(({ source_url, sha256 }) => source_url && /^[a-f0-9]{64}$/.test(sha256)));
});

test("fetch and structure failures reject the whole run", async () => {
  await assert.rejects(
    runSourcePipeline({ root, sourceId: "nta-consumption-tax-rates", fetchImpl: async () => new Response("failure", { status: 503 }), now }),
    /Fetch failed \(503\)/
  );
  await assert.rejects(
    runSourcePipeline({ root, sourceId: "nta-consumption-tax-rates", fetchImpl: fixtureFetch((body) => body.replace("週2回以上発行", "")), now }),
    /Source structure changed/
  );
});
