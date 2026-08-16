import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSourcePipeline } from "./source-pipeline.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const sourceId = option("source");
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

if (!sourceId) {
  console.error("--source is required");
  process.exitCode = 2;
} else {
  try {
    const result = await runSourcePipeline({ root, sourceId, fetchImpl: fixtureDir ? fixtureFetch : globalThis.fetch, dryRun });
    if (output) await writeResult(output, result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { schema_version: 1, status: "error", dry_run: dryRun, source_id: sourceId, error: error.message };
    if (output) await writeResult(output, result);
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
}
