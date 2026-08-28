import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOperationalMonitoring } from "./monitoring-pipeline.js";
import { monitorSources } from "../application/repository-operations.js";
import { writeJsonAtomic } from "../adapters/filesystem-store.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

function fixtureFetch(fixtureDir) {
  return async (url) => {
    const body = await readFile(join(fixtureDir, basename(new URL(url).pathname)));
    const extension = extname(new URL(url).pathname).toLowerCase();
    const contentType = extension === ".pdf" ? "application/pdf" : body.toString("utf8", 0, Math.min(body.length, 32)).trimStart().startsWith("{") ? "application/json" : "text/html; charset=UTF-8";
    return new Response(body, { status: 200, headers: { "content-type": contentType } });
  };
}

const output = option("output");
if (!output) {
  console.error("Usage: node scripts/pipeline/run-monitoring.js --output <result.json> [--fixture-dir <dir>] [--batch <id>] [--dry-run]");
  process.exitCode = 2;
} else {
  try {
    const fixtureDir = option("fixture-dir");
    const result = await monitorSources({ run: runOperationalMonitoring,
      root,
      fetchImpl: fixtureDir ? fixtureFetch(fixtureDir) : globalThis.fetch,
      dryRun: args.includes("--dry-run"),
      batchId: option("batch"),
      semanticBaselinePath: option("semantic-baseline")
    });
    await writeJsonAtomic(output, result);
    console.log(JSON.stringify({ status: result.status, ...result.registry, ...result.routing }));
    if (result.status === "error") process.exitCode = 1;
  } catch (error) {
    const result = { schema_version: 1, status: "error", dry_run: args.includes("--dry-run"), error: error.message, results: [] };
    await writeJsonAtomic(output, result);
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
}
