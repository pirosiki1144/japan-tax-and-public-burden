export function validateNormalizedSource(normalized) {
  const errors = [];
  if (!normalized.source_id) errors.push("source_id is required");
  if (!Array.isArray(normalized.facts) || normalized.facts.length === 0) errors.push("at least one fact is required");
  const factIds = new Set();
  for (const fact of normalized.facts ?? []) {
    if (!fact.fact_id) errors.push("fact_id is required");
    if (factIds.has(fact.fact_id)) errors.push(`duplicate fact_id: ${fact.fact_id}`);
    factIds.add(fact.fact_id);
    if (fact.raw === "") errors.push(`${fact.fact_id}.raw is required`);
    if (fact.value === undefined || (typeof fact.value === "number" && !Number.isFinite(fact.value))) errors.push(`${fact.fact_id}.value is invalid`);
    if (fact.target && (!fact.target.file || !fact.target.record_id || !fact.target.path)) errors.push(`${fact.fact_id}.target is invalid`);
    if (!fact.target && fact.expected_value === undefined) errors.push(`${fact.fact_id} requires a target or expected_value`);
  }
  if (errors.length) throw new Error(`Normalized source is invalid: ${errors.join("; ")}`);
  return normalized;
}
