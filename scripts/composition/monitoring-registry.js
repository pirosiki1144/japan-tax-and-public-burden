import { join } from "node:path";
import { createValidators, readYaml, validateDocument } from "../adapters/schema-validator.js";

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
  const targetIds = registry.targets.map(({ monitoring_target_id: id }) => id);
  const duplicateTargetIds = targetIds.filter((id, index) => targetIds.indexOf(id) !== index);
  if (duplicateTargetIds.length) throw new Error(`Canonical monitoring registry has duplicate monitoring_target_id values: ${[...new Set(duplicateTargetIds)].join(", ")}`);
  if (/https?:\/\//.test(JSON.stringify(registry))) throw new Error("Canonical monitoring registry must reference source IDs instead of URLs");
  for (const [name, projection] of Object.entries(buildDecisionViews(registry))) {
    const projectionErrors = validateDocument(validators[name], projection, `canonical ${name} view`);
    if (projectionErrors.length) throw new Error(`Canonical monitoring registry has an invalid ${name} view: ${projectionErrors.join("; ")}`);
  }
  return registry;
}

export function formatAdapterRegistry(registry) {
  return registry.adapters.formats;
}

export function buildCalculatedComponentCandidates(registry, { policyId, sourceFactId, normalizedValue, outputComponentIds, allocation }) {
  const policy = registry.calculation_policies[policyId];
  if (!policy) throw new Error(`Unknown calculation policy: ${policyId}`);
  if (!Number.isFinite(normalizedValue)) throw new Error("Calculated component input must be a finite direct fact value");
  if (!Array.isArray(outputComponentIds) || outputComponentIds.length === 0) throw new Error("Calculated component outputs are required");
  let values;
  if (policy.operation === "divide") {
    if (outputComponentIds.length !== policy.divisor) throw new Error(`${policyId} requires ${policy.divisor} outputs`);
    values = outputComponentIds.map(() => normalizedValue / policy.divisor);
  } else {
    values = outputComponentIds.map((componentId) => {
      const ratio = allocation?.[componentId];
      if (!Number.isFinite(ratio) || ratio <= 0) throw new Error(`${policyId} requires a positive ratio for ${componentId}`);
      return normalizedValue * ratio;
    });
  }
  if (policy.rounding !== "none") throw new Error(`Rounding policy ${policy.rounding} is not implemented`);
  return outputComponentIds.map((componentId, index) => ({
    component_id: componentId,
    numeric_value: values[index],
    acquisition_type: "calculated",
    calculation_policy_id: policyId,
    input_source_fact_ids: [sourceFactId],
    rounding: policy.rounding
  }));
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
