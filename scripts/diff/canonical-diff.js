import { resolve, sep } from "node:path";
import { readYaml } from "../validate/schema-validator.js";

function canonicalFile(root, relativePath) {
  const dataRoot = `${resolve(root, "data")}${sep}`;
  const path = resolve(root, relativePath);
  if (!path.startsWith(dataRoot)) throw new Error(`Canonical target must stay under data/: ${relativePath}`);
  return path;
}

function selectRecord(document, target) {
  const records = Array.isArray(document) ? document : [document];
  const record = records.find((candidate) => candidate?.[target.record_id_field] === target.record_id);
  if (!record) throw new Error(`Canonical record not found: ${target.record_id}`);
  return record;
}

function readPath(record, path) {
  let value = record;
  for (const segment of path.split(".")) {
    if (value === null || value === undefined || !Object.hasOwn(value, segment)) throw new Error(`Canonical path not found: ${path}`);
    value = value[segment];
  }
  return value;
}

export async function detectCanonicalDiff(root, normalized) {
  const differences = [];
  const documents = new Map();
  for (const fact of normalized.facts) {
    if (!fact.target) {
      if (fact.value !== fact.expected_value) differences.push({ fact_id: fact.fact_id, target: null, current: fact.expected_value, candidate: fact.value, raw: fact.raw });
      continue;
    }
    const path = canonicalFile(root, fact.target.file);
    if (!documents.has(path)) documents.set(path, await readYaml(path));
    const current = readPath(selectRecord(documents.get(path), fact.target), fact.target.path);
    if (current !== fact.value) {
      differences.push({ fact_id: fact.fact_id, target: fact.target, current, candidate: fact.value, raw: fact.raw });
    }
  }
  return differences;
}
