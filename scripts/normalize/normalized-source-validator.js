export function validateNormalizedSource(normalized) {
  const errors = [];
  if (!normalized.source_id) errors.push("source_id is required");
  if (!normalized.tax_id) errors.push("tax_id is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.application_start?.date_value ?? "")) errors.push("application_start.date_value must be an ISO date");
  if (!normalized.application_start?.date_raw) errors.push("application_start.date_raw is required");
  if (!Array.isArray(normalized.phases) || normalized.phases.length === 0) errors.push("at least one phase is required");
  for (const phase of normalized.phases ?? []) {
    if (!phase.phase_id) errors.push("phase_id is required");
    if (!Number.isFinite(phase.numeric_value)) errors.push(`${phase.phase_id ?? "phase"}.numeric_value must be finite`);
    if (!phase.unit) errors.push(`${phase.phase_id ?? "phase"}.unit is required`);
  }
  if (errors.length) throw new Error(`Normalized source is invalid: ${errors.join("; ")}`);
  return normalized;
}
