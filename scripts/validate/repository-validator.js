import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createValidators, readYaml, validateDocument } from "./schema-validator.js";
import { validateIntegrity } from "./integrity-validator.js";
import { buildRuntimeMonitoringPlan } from "../monitoring/build-monitoring-config.js";

const SCHEMA_NAMES = ["monitoring", "monitoring-runtime", "semantic-baseline", "burden", "source", "distribution-config", "public-burden-master", "initial-import", "monitoring-review", "architecture-responsibilities", "architecture-violations-baseline"];

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

export async function validateRepository(root) {
  const errors = [];
  const validatedPaths = new Set();
  const schemaPaths = Object.fromEntries(SCHEMA_NAMES.map((name) => [name, join(root, `schemas/${name}.schema.json`)]));
  const validators = await createValidators(schemaPaths);
  const collections = { monitoringRegistries: [], semanticBaselines: [], burdens: [], candidates: [], changes: [], events: [], phases: [], sources: [], revenues: [], mappings: [], ratios: [], distributionConfigs: [], selectionConfigs: [], monitoringTargets: [], masters: [], initialImports: [], monitoringReviews: [], architectureConfigs: [] };

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
  await validateAndCollect(join(root, "config/monitoring.yaml"), "monitoring", "monitoringRegistries", false);
  await validateAndCollect(join(root, "config/architecture-responsibilities.json"), "architecture-responsibilities", "architectureConfigs", false);
  await validateAndCollect(join(root, "config/architecture-violations-baseline.json"), "architecture-violations-baseline", "architectureConfigs", false);
  await validateAndCollect(join(root, "data/master/canonical.json"), "public-burden-master", "masters", false);
  await validateAndCollect(join(root, "data/master/initial-import.json"), "initial-import", "initialImports", false);
  await validateAndCollect(join(root, "data/monitoring/review.json"), "monitoring-review", "monitoringReviews", false);
  const master = collections.masters?.[0];
  if (master) collections.burdens.push(...master.public_burdens.flatMap(({ legacy_record }) => legacy_record ? [legacy_record] : []));
  const review = collections.monitoringReviews?.[0];
  if (review?.baseline) collections.semanticBaselines.push(review.baseline);
  const monitoringPath = "generated monitoring runtime plan";
  try {
    const monitoring = await buildRuntimeMonitoringPlan(root);
    const monitoringErrors = validateDocument(validators["monitoring-runtime"], monitoring, monitoringPath);
    errors.push(...monitoringErrors);
    if (monitoringErrors.length === 0) collections.monitoringTargets.push(...monitoring.targets);
  } catch (error) {
    errors.push(`${monitoringPath}: ${error.message}`);
  }

  errors.push(...validateIntegrity(collections));
  errors.push(...await validatePersistedFileCoverage(root, validatedPaths));
  return { errors, collections };
}
