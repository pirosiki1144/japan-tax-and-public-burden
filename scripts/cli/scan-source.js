import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAutomatedSources, runSourcePipeline } from "../composition/source-pipeline.js";
import { scanSources } from "../application/repository-operations.js";
import { writeJsonAtomic } from "../adapters/filesystem-store.js";

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
  const body = await readFile(path);
  const extension = extname(new URL(url).pathname).toLowerCase();
  const contentType = extension === ".pdf" ? "application/pdf" : body.toString("utf8", 0, Math.min(body.length, 32)).trimStart().startsWith("{") ? "application/json" : "text/html; charset=UTF-8";
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

if ((!sourceId && !scanAll) || (sourceId && scanAll)) {
  console.error("Specify exactly one of --source or --all");
  process.exitCode = 2;
} else {
  try {
    const options = { root, fetchImpl: fixtureDir ? fixtureFetch : globalThis.fetch, dryRun };
    const result = await scanSources({ ...options, sourceId, scanAll, runAll: runAutomatedSources, runOne: runSourcePipeline });
    if (output) await writeJsonAtomic(output, result);
    console.log(JSON.stringify(result));
    if (result.status === "error") process.exitCode = 1;
  } catch (error) {
    const result = { schema_version: 1, status: "error", dry_run: dryRun, source_id: sourceId ?? "all", error: error.message };
    if (output) await writeJsonAtomic(output, result);
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
}
