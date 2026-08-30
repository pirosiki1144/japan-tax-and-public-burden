import { resolve, sep } from "node:path";
import { readYaml } from "../adapters/schema-validator.js";

function canonicalFile(root, relativePath) {
  const dataRoot = `${resolve(root, "data")}${sep}`;
  const path = resolve(root, relativePath);
  if (!path.startsWith(dataRoot)) throw new Error(`Canonical target must stay under data/: ${relativePath}`);
  return path;
}

function selectRecord(document, target) {
  if (document && typeof document === "object" && document[target.record_id_field] === target.record_id) return document;
  for (const child of Array.isArray(document) ? document : Object.values(document ?? {})) {
    const record = child && typeof child === "object" ? selectRecordOrNull(child, target) : null;
    if (record) return record;
  }
  throw new Error(`Canonical record not found: ${target.record_id}`);
}

function selectRecordOrNull(document, target) {
  if (document && typeof document === "object" && document[target.record_id_field] === target.record_id) return document;
  for (const child of Array.isArray(document) ? document : Object.values(document ?? {})) {
    const record = child && typeof child === "object" ? selectRecordOrNull(child, target) : null;
    if (record) return record;
  }
  return null;
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
