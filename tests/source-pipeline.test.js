import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSourcePipeline } from "../scripts/pipeline/source-pipeline.js";

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
  assert.deepEqual(result.candidate_diff[0], {
    path: "phases.consumption-tax-standard-rate-2019.value.numeric_value", current: 7.8, candidate: 7.9
  });
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
