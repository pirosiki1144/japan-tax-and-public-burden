import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractEgovTaxSemantics, extractGenericNationalTaxSemantics } from "../normalize/egov-tax-semantics.js";
import { readYaml } from "../validate/schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function loadDocument(url, { fixtureDir, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  let bytes;
  let contentType;
  if (fixtureDir) {
    bytes = await readFile(join(fixtureDir, basename(new URL(url).pathname)));
    contentType = "application/json";
  } else {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`e-Gov fetch failed (${response.status}) for ${url}`);
    contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) throw new Error(`e-Gov response is not JSON for ${url}: ${contentType || "unknown"}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`e-Gov response is unreadable for ${url}: ${error.message}`);
  }
  return {
    document,
    evidence: { source_url: url, fetched_at: now().toISOString(), sha256: createHash("sha256").update(bytes).digest("hex"), content_type: contentType }
  };
}

function configuredSource(monitoring, taxId) {
  const target = monitoring.targets.find(({ tax_id }) => tax_id === taxId);
  const source = target?.sources.find(({ target_url: targetUrl, change_detection }) => change_detection?.document_format === "egov_law_api_v2_json" || new URL(targetUrl).pathname.startsWith("/api/2/law_data/"));
  if (!source) throw new Error(`${taxId}: e-Gov semantic source is missing`);
  return source;
}

export async function extractConfiguredSemanticTarget(repositoryRoot, taxId, options = {}) {
  const monitoring = options.monitoring ?? await readYaml(join(repositoryRoot, "config/monitoring.yaml"));
  const source = configuredSource(monitoring, taxId);
  const { document, evidence } = await loadDocument(source.target_url, options);
  try {
    const extractor = ["consumption-tax", "automobile-tax"].includes(taxId) ? extractEgovTaxSemantics : extractGenericNationalTaxSemantics;
    return { record: extractor(document, taxId, source.target_url), fetches: [evidence] };
  } catch (error) {
    error.fetches = [evidence];
    error.sourceUrl = source.target_url;
    throw error;
  }
}

export async function extractConfiguredSemantics(repositoryRoot, options = {}) {
  const monitoring = await readYaml(join(repositoryRoot, "config/monitoring.yaml"));
  const records = [];
  for (const taxId of ["consumption-tax", "automobile-tax"]) {
    const { record } = await extractConfiguredSemanticTarget(repositoryRoot, taxId, { ...options, monitoring });
    records.push(record);
  }
  return { schema_version: 1, records };
}

async function run() {
  const fixtureDir = option("--fixture-dir");
  const output = option("--output");
  const expected = option("--expected");
  const result = await extractConfiguredSemantics(root, { fixtureDir });
  const content = `${JSON.stringify(result, null, 2)}\n`;
  if (expected) {
    const expectedDocument = JSON.parse(await readFile(expected, "utf8"));
    if (JSON.stringify(expectedDocument) !== JSON.stringify(result)) throw new Error(`Semantic extraction differs from ${expected}`);
  }
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content, "utf8");
  } else process.stdout.write(content);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
