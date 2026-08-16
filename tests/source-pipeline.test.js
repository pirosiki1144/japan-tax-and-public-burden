import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnabledSource } from "../scripts/fetch/source-registry.js";
import { runAutomatedSources, runConfiguredSources, runSourcePipeline } from "../scripts/pipeline/source-pipeline.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(root, "tests/fixtures/nta-consumption-tax-rates");
const now = () => new Date("2026-08-17T01:02:03+09:00");

function fixtureFetch(transform = (body) => body) {
  return async (url) => {
    const body = transform(await readFile(join(fixtureRoot, basename(new URL(url).pathname)), "utf8"), url);
    return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } });
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
  assert.deepEqual(result.results.map(({ source_id }) => source_id), ["nta-consumption-tax-rates"]);
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
