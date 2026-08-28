import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { parse } from "csv-parse/sync";
import { createValidators, readYaml, validateDocument } from "./schema-validator.js";
import { validateIntegrity } from "./integrity-validator.js";
import { buildRuntimeMonitoringPlan } from "../monitoring/build-monitoring-config.js";

const SCHEMA_NAMES = ["monitoring", "monitoring-runtime", "format-adapters", "semantic-baseline", "burden", "initial-master-candidate", "initial-master-selection", "change", "event", "phase", "source", "revenue", "national-burden-ratio", "national-burden-ratio-mapping", "distribution-config"];

const DIRECTORY_SCHEMA_ROUTES = new Map([
  ["data/burdens", "burden"],
  ["data/candidates", "initial-master-candidate"],
  ["data/changes", "change"],
  ["data/events", "event"],
  ["data/phases", "phase"]
]);

async function persistedFiles(root, directory) {
  const files = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await persistedFiles(root, path));
    else if (entry.name !== ".gitkeep") files.push(path);
  }
  return files;
}

export async function validatePersistedFileCoverage(root, validatedPaths) {
  const expected = new Set([
    ...await persistedFiles(root, "config"),
    ...await persistedFiles(root, "data")
  ]);
  const actual = new Set([...validatedPaths].map((path) => relative(root, path)));
  return [...expected].filter((path) => !actual.has(path)).map((path) => `${path}: no repository schema validation route`);
}

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
  const validatedPaths = new Set();
  const schemaPaths = Object.fromEntries(SCHEMA_NAMES.map((name) => [name, join(root, `schemas/${name}.schema.json`)]));
  const schemas = Object.fromEntries(await Promise.all(SCHEMA_NAMES.map(async (name) => [name, JSON.parse(await readFile(schemaPaths[name], "utf8"))])));
  const validators = await createValidators(schemaPaths);
  const collections = { monitoringRegistries: [], formatAdapters: [], semanticBaselines: [], burdens: [], candidates: [], changes: [], events: [], phases: [], sources: [], revenues: [], mappings: [], ratios: [], distributionConfigs: [], selectionConfigs: [], monitoringTargets: [] };

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
      validatedPaths.add(path);
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
    validatedPaths.add(sourcePath);
  } catch (error) {
    errors.push(`${sourcePath}: ${error.message}`);
  }

  await validateAndCollect(join(root, "config/distribution.yaml"), "distribution-config", "distributionConfigs", false);
  await validateAndCollect(join(root, "config/initial-master-selection.yaml"), "initial-master-selection", "selectionConfigs", false);
  await validateAndCollect(join(root, "config/monitoring.yaml"), "monitoring", "monitoringRegistries", false);
  await validateAndCollect(join(root, "config/format-adapters.yaml"), "format-adapters", "formatAdapters", false);
  await validateAndCollect(join(root, "data/monitoring/semantic-baseline.json"), "semantic-baseline", "semanticBaselines", false);
  const monitoringPath = "generated monitoring runtime plan";
  try {
    const monitoring = await buildRuntimeMonitoringPlan(root);
    const monitoringErrors = validateDocument(validators["monitoring-runtime"], monitoring, monitoringPath);
    errors.push(...monitoringErrors);
    if (monitoringErrors.length === 0) collections.monitoringTargets.push(...monitoring.targets);
  } catch (error) {
    errors.push(`${monitoringPath}: ${error.message}`);
  }

  for (const [directory, schemaName] of DIRECTORY_SCHEMA_ROUTES) {
    const path = join(root, directory);
    const target = directory.slice("data/".length);
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
    validatedPaths.add(mappingPath);
  } catch (error) {
    errors.push(`${mappingPath}: ${error.message}`);
  }

  for (const [relativePath, schemaName, target] of [
    ["data/revenue/actuals.csv", "revenue", "revenues"],
    ["data/reconciliation/national-burden-ratio.csv", "national-burden-ratio", "ratios"]
  ]) {
    const path = join(root, relativePath);
    const records = await parseCsvFile(path, schemas[schemaName], errors);
    validatedPaths.add(path);
    records.forEach((record, index) => {
      const recordErrors = validateDocument(validators[schemaName], record, `${path}[${index}]`);
      errors.push(...recordErrors);
      if (recordErrors.length === 0) collections[target].push(record);
    });
  }

  errors.push(...validateIntegrity(collections));
  errors.push(...await validatePersistedFileCoverage(root, validatedPaths));
  return { errors, collections };
}
