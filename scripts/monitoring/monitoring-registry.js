import { join } from "node:path";
import { createValidators, readYaml, validateDocument } from "../validate/schema-validator.js";

export async function loadMonitoringRegistry(root) {
  const path = join(root, "config/monitoring.yaml");
  const registry = await readYaml(path);
  const validators = await createValidators({
    registry: join(root, "schemas/monitoring.schema.json"),
    "national-tax-adapters": join(root, "schemas/national-tax-adapters.schema.json"),
    "local-tax-adapters": join(root, "schemas/local-tax-adapters.schema.json"),
    "social-insurance-adapters": join(root, "schemas/social-insurance-adapters.schema.json"),
    "public-burden-adapters": join(root, "schemas/public-burden-adapters.schema.json")
  });
  const errors = validateDocument(validators.registry, registry, "config/monitoring.yaml");
  if (errors.length) throw new Error(`Canonical monitoring registry is invalid: ${errors.join("; ")}`);
  const ids = registry.targets.map(({ tax_id: taxId }) => taxId);
  const duplicates = ids.filter((taxId, index) => ids.indexOf(taxId) !== index);
  if (duplicates.length) throw new Error(`Canonical monitoring registry has duplicate tax_id values: ${[...new Set(duplicates)].join(", ")}`);
  for (const [name, projection] of Object.entries(buildDecisionViews(registry))) {
    const projectionErrors = validateDocument(validators[name], projection, `canonical ${name} view`);
    if (projectionErrors.length) throw new Error(`Canonical monitoring registry has an invalid ${name} view: ${projectionErrors.join("; ")}`);
  }
  return registry;
}

function standardProjection(manifest, issue) {
  const profile = manifest.metadata.decision_profiles[String(issue)];
  return {
    schema_version: 1,
    verified_at: profile.verified_at,
    implementation_issue: issue,
    ...(profile.value_scope ? { value_scope: profile.value_scope } : {}),
    targets: manifest.targets.filter(({ implementation_issue: targetIssue }) => targetIssue === issue)
      .sort((left, right) => left.projection_order - right.projection_order)
      .map(({ tax_id: taxId, implementation_status: status, decision }) => ({ tax_id: taxId, status, ...decision }))
  };
}

function publicProjection(manifest) {
  const profile = manifest.metadata.decision_profiles["45"];
  const targets = manifest.targets.filter(({ implementation_issue }) => implementation_issue === 45);
  const grouped = new Map();
  for (const target of targets.filter(({ decision_kind: kind }) => kind === "public_grouped_hold")) {
    const key = JSON.stringify(target.decision);
    if (!grouped.has(key)) grouped.set(key, { ...target.decision, tax_ids: [] });
    grouped.get(key).tax_ids.push(target.tax_id);
  }
  return {
    schema_version: 1,
    verified_at: profile.verified_at,
    implementation_issue: 45,
    implemented_targets: targets.filter(({ decision_kind: kind }) => kind === "public_implemented")
      .sort((left, right) => left.projection_order - right.projection_order)
      .map(({ tax_id: taxId, decision }) => ({ tax_id: taxId, ...decision })),
    manual_targets: targets.filter(({ decision_kind: kind }) => kind === "public_manual")
      .sort((left, right) => left.projection_order - right.projection_order)
      .map(({ tax_id: taxId, decision }) => ({ tax_id: taxId, ...decision })),
    held_groups: [...grouped.values()].map(({ tax_ids: taxIds, ...decision }) => ({ ...decision, tax_ids: taxIds.sort() }))
  };
}

export function buildDecisionViews(registry) {
  return {
    "national-tax-adapters": standardProjection(registry, 42),
    "local-tax-adapters": standardProjection(registry, 43),
    "social-insurance-adapters": standardProjection(registry, 44),
    "public-burden-adapters": publicProjection(registry)
  };
}

export function registryByTaxId(registry) {
  return new Map(registry.targets.map((target) => [target.tax_id, target]));
}
