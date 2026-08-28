const ID_FIELDS = {
  burdens: "tax_id",
  candidates: "candidate_id",
  changes: "change_id",
  events: "event_id",
  phases: "phase_id",
  sources: "source_id",
  revenues: "record_id",
  mappings: "mapping_id"
};

function indexById(records, field, errors) {
  const index = new Map();
  for (const record of records) {
    const id = record[field];
    if (index.has(id)) errors.push(`${field}: duplicate ID ${id}`);
    else index.set(id, record);
  }
  return index;
}

function requireReference(index, value, location, errors) {
  if (!index.has(value)) errors.push(`${location}: unknown reference ${value}`);
}

function validateDateOrder(record, startField, endField, location, errors) {
  const start = record[startField];
  const end = record[endField];
  if (start && end && start > end) errors.push(`${location}: ${startField} must not be after ${endField}`);
}

export function validateIntegrity(collections) {
  const errors = [];
  const indexes = Object.fromEntries(Object.entries(ID_FIELDS).map(([name, field]) => [name, indexById(collections[name] ?? [], field, errors)]));

  for (const burden of collections.burdens ?? []) {
    burden.current_phases.forEach((id) => requireReference(indexes.phases, id, `${burden.tax_id}.current_phases`, errors));
    burden.pending_changes.forEach((id) => requireReference(indexes.changes, id, `${burden.tax_id}.pending_changes`, errors));
    burden.source_refs.forEach((id) => requireReference(indexes.sources, id, `${burden.tax_id}.source_refs`, errors));
  }

  for (const change of collections.changes ?? []) {
    change.tax_ids.forEach((id) => requireReference(indexes.burdens, id, `${change.change_id}.tax_ids`, errors));
    change.events.forEach((id) => requireReference(indexes.events, id, `${change.change_id}.events`, errors));
    change.source_refs.forEach((id) => requireReference(indexes.sources, id, `${change.change_id}.source_refs`, errors));
  }

  const phaseKeys = new Set();
  for (const phase of collections.phases ?? []) {
    requireReference(indexes.burdens, phase.tax_id, `${phase.phase_id}.tax_id`, errors);
    requireReference(indexes.changes, phase.change_id, `${phase.phase_id}.change_id`, errors);
    phase.source_refs.forEach((id) => requireReference(indexes.sources, id, `${phase.phase_id}.source_refs`, errors));
    validateDateOrder(phase, "application_start", "application_end", phase.phase_id, errors);
    validateDateOrder(phase, "collection_start", "collection_end", phase.phase_id, errors);
    const key = [phase.tax_id, phase.change_id, phase.collection_start ?? "unknown", phase.phase_sequence].join("|");
    if (phaseKeys.has(key)) errors.push(`phase composite key: duplicate ${key}`);
    phaseKeys.add(key);
  }

  for (const event of collections.events ?? []) {
    requireReference(indexes.changes, event.change_id, `${event.event_id}.change_id`, errors);
  }

  for (const source of collections.sources ?? []) {
    for (const taxId of source.monitoring_tax_ids ?? []) {
      requireReference(indexes.burdens, taxId, `${source.source_id}.monitoring_tax_ids`, errors);
    }
  }

  for (const baseline of collections.semanticBaselines ?? []) {
    for (const record of baseline.records ?? []) {
      requireReference(indexes.burdens, record.tax_id, `${record.tax_id}.semantic_baseline.tax_id`, errors);
    }
  }

  for (const revenue of collections.revenues ?? []) {
    requireReference(indexes.burdens, revenue.tax_id, `${revenue.record_id}.tax_id`, errors);
    validateDateOrder(revenue, "period_start", "period_end", revenue.record_id, errors);
  }

  for (const mapping of collections.mappings ?? []) {
    requireReference(indexes.burdens, mapping.tax_id, `${mapping.mapping_id}.tax_id`, errors);
  }

  if (collections.monitoringTargets !== undefined) {
    const monitoredTaxIds = new Set();
    for (const target of collections.monitoringTargets) {
      requireReference(indexes.burdens, target.tax_id, `${target.tax_id}.monitoring.tax_id`, errors);
      if (monitoredTaxIds.has(target.tax_id)) errors.push(`monitoring tax_id: duplicate ${target.tax_id}`);
      monitoredTaxIds.add(target.tax_id);
      for (const source of target.sources) requireReference(indexes.sources, source.source_id, `${target.tax_id}.monitoring.source_id`, errors);
    }
    for (const burden of collections.burdens ?? []) {
      if (!monitoredTaxIds.has(burden.tax_id)) errors.push(`${burden.tax_id}: missing monitoring target`);
    }
  }

  return errors;
}
