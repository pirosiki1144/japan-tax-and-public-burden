import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const errors = [];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    return null;
  }
}

function checkUnique(items, key, location) {
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item[key] !== "string" || item[key] === "") errors.push(`${location}: missing ${key}`);
    else if (seen.has(item[key])) errors.push(`${location}: duplicate ${key} ${item[key]}`);
    else seen.add(item[key]);
  }
}

const config = await readJson(join(root, "config/sources.yaml"));
if (config) {
  if (!Array.isArray(config.sources)) errors.push("config/sources.yaml: sources must be an array");
  else {
    checkUnique(config.sources, "source_id", "config/sources.yaml");
    for (const source of config.sources) {
      if (!Array.isArray(source.entry_urls) || source.entry_urls.length === 0) errors.push(`${source.source_id}: entry_urls must not be empty`);
      for (const url of [source.base_url, source.terms_url, ...(source.entry_urls ?? [])]) {
        if (typeof url !== "string" || !url.startsWith("https://")) errors.push(`${source.source_id}: URL must use HTTPS: ${url}`);
      }
    }
  }
}

for (const schemaName of ["burden", "change", "event", "phase", "source"]) {
  const schema = await readJson(join(root, `schemas/${schemaName}.schema.json`));
  if (schema && schema.$schema !== "https://json-schema.org/draft/2020-12/schema") errors.push(`${schemaName}.schema.json: unexpected JSON Schema draft`);
}

for (const directory of ["burdens", "changes", "events", "phases"]) {
  const path = join(root, "data", directory);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isFile() && [".json", ".yaml"].includes(extname(entry.name))) await readJson(join(path, entry.name));
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Configuration, schemas, and data files are valid.");
}
