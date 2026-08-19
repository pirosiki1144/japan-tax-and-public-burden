import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parse } from "csv-parse/sync";
import { createValidators, readYaml, validateDocument } from "./schema-validator.js";
import { validateIntegrity } from "./integrity-validator.js";

const SCHEMA_NAMES = ["adapter-inventory", "burden", "initial-master-candidate", "initial-master-selection", "monitoring", "change", "event", "phase", "source", "revenue", "national-burden-ratio", "national-burden-ratio-mapping", "distribution-config"];

async function parseCsvFile(path, schema, errors) {
  try {
    const rows = parse(await readFile(path, "utf8"), { bom: true, skip_empty_lines: true });
    if (rows.length === 0) {
      errors.push(`${path}: CSV header is required`);
      return [];
    }
    const [header, ...values] = rows;
    const expected = schema.required;
    if (header.length !== expected.length || header.some((column, index) => column !== expected[index])) {
      errors.push(`${path}: CSV header must be ${expected.join(",")}`);
      return [];
    }
    return values.map((row, index) => {
      if (row.length !== header.length) {
        errors.push(`${path}[${index}]: expected ${header.length} columns but found ${row.length}`);
        return null;
      }
      return Object.fromEntries(header.map((column, columnIndex) => [column, row[columnIndex]]));
    }).filter(Boolean);
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
    return [];
  }
}

export async function validateRepository(root) {
  const errors = [];
  const schemaPaths = Object.fromEntries(SCHEMA_NAMES.map((name) => [name, join(root, `schemas/${name}.schema.json`)]));
  const schemas = Object.fromEntries(await Promise.all(SCHEMA_NAMES.map(async (name) => [name, JSON.parse(await readFile(schemaPaths[name], "utf8"))])));
  const validators = await createValidators(schemaPaths);
  const collections = { adapterInventories: [], burdens: [], candidates: [], changes: [], events: [], phases: [], sources: [], revenues: [], mappings: [], ratios: [], distributionConfigs: [], selectionConfigs: [], monitoringTargets: [] };

  async function validateAndCollect(path, schemaName, target, allowArray = true) {
    try {
      const parsed = await readYaml(path);
      const documents = allowArray && Array.isArray(parsed) ? parsed : [parsed];
      documents.forEach((document, index) => {
        const location = documents.length === 1 ? path : `${path}[${index}]`;
        const documentErrors = validateDocument(validators[schemaName], document, location);
        errors.push(...documentErrors);
        if (documentErrors.length === 0) collections[target].push(document);
      });
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
    }
  }

  const sourcePath = join(root, "config/sources.yaml");
  try {
    const sourceRegistry = await readYaml(sourcePath);
    const sourceErrors = validateDocument(validators.source, sourceRegistry, sourcePath);
    errors.push(...sourceErrors);
    if (sourceErrors.length === 0) collections.sources.push(...sourceRegistry.sources);
  } catch (error) {
    errors.push(`${sourcePath}: ${error.message}`);
  }

  await validateAndCollect(join(root, "config/distribution.yaml"), "distribution-config", "distributionConfigs", false);
  await validateAndCollect(join(root, "config/initial-master-selection.yaml"), "initial-master-selection", "selectionConfigs", false);
  await validateAndCollect(join(root, "config/adapter-inventory.yaml"), "adapter-inventory", "adapterInventories", false);
  const monitoringPath = join(root, "config/monitoring.yaml");
  try {
    const monitoring = await readYaml(monitoringPath);
    const monitoringErrors = validateDocument(validators.monitoring, monitoring, monitoringPath);
    errors.push(...monitoringErrors);
    if (monitoringErrors.length === 0) collections.monitoringTargets.push(...monitoring.targets);
  } catch (error) {
    errors.push(`${monitoringPath}: ${error.message}`);
  }

  for (const [directory, schemaName, target] of [
    ["burdens", "burden", "burdens"],
    ["candidates", "initial-master-candidate", "candidates"],
    ["changes", "change", "changes"],
    ["events", "event", "events"],
    ["phases", "phase", "phases"]
  ]) {
    const path = join(root, "data", directory);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isFile() && [".json", ".yaml", ".yml"].includes(extname(entry.name))) {
        await validateAndCollect(join(path, entry.name), schemaName, target);
      }
    }
  }

  const mappingPath = join(root, "data/reconciliation/national-burden-ratio-mapping.yaml");
  try {
    const mappingRegistry = await readYaml(mappingPath);
    const mappingErrors = validateDocument(validators["national-burden-ratio-mapping"], mappingRegistry, mappingPath);
    errors.push(...mappingErrors);
    if (mappingErrors.length === 0) collections.mappings.push(...mappingRegistry.mappings);
  } catch (error) {
    errors.push(`${mappingPath}: ${error.message}`);
  }

  for (const [relativePath, schemaName, target] of [
    ["data/revenue/actuals.csv", "revenue", "revenues"],
    ["data/reconciliation/national-burden-ratio.csv", "national-burden-ratio", "ratios"]
  ]) {
    const path = join(root, relativePath);
    const records = await parseCsvFile(path, schemas[schemaName], errors);
    records.forEach((record, index) => {
      const recordErrors = validateDocument(validators[schemaName], record, `${path}[${index}]`);
      errors.push(...recordErrors);
      if (recordErrors.length === 0) collections[target].push(record);
    });
  }

  errors.push(...validateIntegrity(collections));
  return { errors, collections };
}
