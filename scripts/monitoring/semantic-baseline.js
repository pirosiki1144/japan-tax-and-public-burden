import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { diffSemanticValues } from "../normalize/egov-tax-semantics.js";
import { createValidators, validateDocument } from "../validate/schema-validator.js";

const metadataKeys = new Set(["schema_version", "tax_id", "law_id", "law_title", "revision_id", "updated_at", "source_url"]);

export function semanticProjection(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !metadataKeys.has(key)));
}

export function buildSemanticBaseline(run) {
  const records = (run.results ?? [])
    .filter(({ source_id, status, normalized }) => source_id?.startsWith("semantic:") && status !== "error" && normalized)
    .map(({ normalized }) => normalized)
    .sort((left, right) => left.tax_id.localeCompare(right.tax_id, "en"));
  if (records.length === 0) throw new Error("Monitoring run contains no successful semantic records");
  return { schema_version: 1, reviewed_at: run.completed_at, records };
}

export async function loadSemanticBaseline(root, path = join(root, "data/monitoring/review.json")) {
  const document = JSON.parse(await readFile(path, "utf8"));
  const baseline = document.baseline ?? document;
  const { baseline: validateBaseline } = await createValidators({ baseline: join(root, "schemas/semantic-baseline.schema.json") });
  const errors = validateDocument(validateBaseline, baseline, path);
  if (errors.length) throw new Error(`Semantic baseline is invalid: ${errors.join("; ")}`);
  if (new Set(baseline.records.map(({ tax_id }) => tax_id)).size !== baseline.records.length) throw new Error("Semantic baseline contains duplicate tax_id values");
  return baseline;
}

export function diffAgainstSemanticBaseline(record, baseline) {
  const previous = baseline.records.find(({ tax_id }) => tax_id === record.tax_id);
  if (!previous) {
    const error = new Error(`Semantic baseline is missing: ${record.tax_id}`);
    error.code = "semantic_baseline_missing";
    throw error;
  }
  return diffSemanticValues(semanticProjection(previous), semanticProjection(record)).map(({ path, old_value, new_value }) => ({
    fact_id: `semantic:${path}`,
    target: null,
    current: old_value,
    candidate: new_value
  }));
}
