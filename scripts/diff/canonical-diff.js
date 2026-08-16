import { join } from "node:path";
import { readYaml } from "../validate/schema-validator.js";

export async function detectCanonicalDiff(root, normalized) {
  const phases = await readYaml(join(root, "data/phases/consumption-tax.yaml"));
  const changes = await readYaml(join(root, "data/changes/consumption-tax-2019-rate.yaml"));
  const differences = [];
  const applicationStart = changes.application_start_dates.find(({ date_value: value }) => value === normalized.application_start.date_value);
  if (!applicationStart || applicationStart.date_raw !== normalized.application_start.date_raw) {
    differences.push({ path: "change.application_start_dates", current: changes.application_start_dates, candidate: normalized.application_start });
  }
  for (const candidate of normalized.phases) {
    const current = phases.find(({ phase_id: id }) => id === candidate.phase_id);
    if (!current) {
      differences.push({ path: `phases.${candidate.phase_id}`, current: null, candidate });
      continue;
    }
    for (const field of ["numeric_value", "unit"]) {
      if (current.value[field] !== candidate[field]) {
        differences.push({ path: `phases.${candidate.phase_id}.value.${field}`, current: current.value[field], candidate: candidate[field] });
      }
    }
  }
  return differences;
}
