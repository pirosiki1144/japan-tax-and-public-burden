import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAutomatedSources, runSourcePipeline } from "./source-pipeline.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const sourceId = option("source");
const scanAll = args.includes("--all");
const output = option("output");
const fixtureDir = option("fixture-dir");
const dryRun = args.includes("--dry-run");

async function fixtureFetch(url) {
  const path = join(fixtureDir, basename(new URL(url).pathname));
  const body = await readFile(path, "utf8");
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } });
}

async function writeResult(path, result) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

if ((!sourceId && !scanAll) || (sourceId && scanAll)) {
  console.error("Specify exactly one of --source or --all");
  process.exitCode = 2;
} else {
  try {
    const options = { root, fetchImpl: fixtureDir ? fixtureFetch : globalThis.fetch, dryRun };
    const result = scanAll ? await runAutomatedSources(options) : await runSourcePipeline({ ...options, sourceId });
    if (output) await writeResult(output, result);
    console.log(JSON.stringify(result));
    if (result.status === "error") process.exitCode = 1;
  } catch (error) {
    const result = { schema_version: 1, status: "error", dry_run: dryRun, source_id: sourceId ?? "all", error: error.message };
    if (output) await writeResult(output, result);
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
}
