import { join } from "node:path";
import { createValidators, readYaml, validateDocument } from "../validate/schema-validator.js";

export async function loadSourceRegistry(root) {
  const registryPath = join(root, "config/sources.yaml");
  const registry = await readYaml(registryPath);
  const { source: validateSource } = await createValidators({ source: join(root, "schemas/source.schema.json") });
  const errors = validateDocument(validateSource, registry, registryPath);
  if (errors.length) throw new Error(`Source registry is invalid: ${errors.join("; ")}`);
  return registry.sources;
}

export async function loadEnabledSource(root, sourceId) {
  const sources = await loadSourceRegistry(root);
  const source = sources.find(({ source_id: id }) => id === sourceId);
  if (!source) throw new Error(`Unknown source_id: ${sourceId}`);
  if (!source.enabled) throw new Error(`Source is disabled: ${sourceId}`);
  return source;
}

export async function loadAutomatedSources(root) {
  const sources = await loadSourceRegistry(root);
  return sources.filter(({ enabled, automation_enabled: automated }) => enabled && automated);
}
