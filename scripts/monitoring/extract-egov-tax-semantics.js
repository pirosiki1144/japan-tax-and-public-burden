import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractEgovTaxSemantics } from "../normalize/egov-tax-semantics.js";
import { readYaml } from "../validate/schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function loadDocument(url, fixtureDir) {
  if (fixtureDir) return JSON.parse(await readFile(join(fixtureDir, basename(new URL(url).pathname)), "utf8"));
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`e-Gov fetch failed (${response.status}) for ${url}`);
  return response.json();
}

export async function extractConfiguredSemantics(repositoryRoot, { fixtureDir } = {}) {
  const monitoring = await readYaml(join(repositoryRoot, "config/monitoring.yaml"));
  const records = [];
  for (const taxId of ["consumption-tax", "automobile-tax"]) {
    const target = monitoring.targets.find(({ tax_id }) => tax_id === taxId);
    const source = target?.sources.find(({ change_detection }) => change_detection?.document_format === "egov_law_api_v2_json");
    if (!source) throw new Error(`${taxId}: e-Gov semantic source is missing`);
    records.push(extractEgovTaxSemantics(await loadDocument(source.target_url, fixtureDir), taxId, source.target_url));
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
