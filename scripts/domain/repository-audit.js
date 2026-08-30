import { deriveBurdenStatus } from "./derive-status.js";

function add(findings, severity, code, recordId, message) {
  findings.push({ severity, code, record_id: recordId, message });
}

function knownDate(evidencedDate) {
  return evidencedDate?.date_value ?? null;
}

function rangesOverlap(left, right) {
  if (!left.application_start || !right.application_start) return false;
  const leftEnd = left.application_end ?? "9999-12-31";
  const rightEnd = right.application_end ?? "9999-12-31";
  return left.application_start <= rightEnd && right.application_start <= leftEnd;
}

function nextDay(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function auditRepositoryCollections(collections, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const findings = [];
  const changes = new Map((collections.changes ?? []).map((record) => [record.change_id, record]));
  const events = new Map((collections.events ?? []).map((record) => [record.event_id, record]));
  const phases = new Map((collections.phases ?? []).map((record) => [record.phase_id, record]));
  const registeredOrigins = new Set((collections.sources ?? []).map(({ base_url }) => {
    try { return new URL(base_url).origin; } catch { return null; }
  }).filter(Boolean));
  const burdenLawIds = new Set((collections.burdens ?? []).flatMap(({ legal_bases }) => (legal_bases ?? []).map(({ law_id }) => law_id).filter(Boolean)));

  const auditSourceUrl = (url, recordId) => {
    if (registeredOrigins.size === 0 || !url) return;
    let origin;
    try { origin = new URL(url).origin; } catch { return; }
    if (!registeredOrigins.has(origin)) add(findings, "warning", "unregistered_source_origin", recordId, `${origin} is not represented in config/sources.yaml`);
  };

  for (const change of collections.changes ?? []) {
    const orderedDates = [
      ["promulgation_date", knownDate(change.promulgation_date)],
      ["enforcement_date", knownDate(change.enforcement_date)],
      ["application_start_date", (change.application_start_dates ?? []).map(knownDate).filter(Boolean).sort()[0] ?? null],
      ["collection_start_date", (change.collection_start_dates ?? []).map(knownDate).filter(Boolean).sort()[0] ?? null]
    ];
    for (let leftIndex = 0; leftIndex < orderedDates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < orderedDates.length; rightIndex += 1) {
        const [previousName, previous] = orderedDates[leftIndex];
        const [currentName, current] = orderedDates[rightIndex];
        if (previous && current && previous > current) add(findings, "warning", "date_order_requires_review", change.change_id, `${previousName} ${previous} is after ${currentName} ${current}`);
      }
    }
    for (const lawId of change.law_ids ?? []) {
      if (!burdenLawIds.has(lawId)) add(findings, "warning", "unlinked_law_id", change.change_id, `${lawId} is not present in the related burden legal_bases`);
    }
    for (const eventId of change.events ?? []) {
      const event = events.get(eventId);
      if (event && event.change_id !== change.change_id) add(findings, "error", "event_change_mismatch", change.change_id, `${eventId} points to ${event.change_id}`);
    }
  }

  for (const phase of collections.phases ?? []) {
    const change = changes.get(phase.change_id);
    if (change && !change.tax_ids.includes(phase.tax_id)) add(findings, "error", "phase_change_tax_mismatch", phase.phase_id, `${phase.tax_id} is not included in ${phase.change_id}.tax_ids`);
    if (phase.application_start && phase.collection_start && phase.collection_start < phase.application_start) add(findings, "warning", "collection_before_application", phase.phase_id, `${phase.collection_start} is before ${phase.application_start}`);
    if (phase.value?.kind === "rate" && phase.value.unit !== "percent") add(findings, "error", "rate_unit_mismatch", phase.phase_id, `rate value uses ${phase.value.unit}`);
  }

  const phaseGroups = new Map();
  for (const phase of collections.phases ?? []) {
    const key = `${phase.tax_id}|${phase.subject_scope}`;
    if (!phaseGroups.has(key)) phaseGroups.set(key, []);
    phaseGroups.get(key).push(phase);
  }
  for (const [key, group] of phaseGroups) {
    const ordered = group.filter(({ application_start }) => application_start).sort((a, b) => a.application_start.localeCompare(b.application_start));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (rangesOverlap(previous, current)) add(findings, "warning", "phase_period_overlap", key, `${previous.phase_id} overlaps ${current.phase_id}`);
      else if (previous.application_end && nextDay(previous.application_end) < current.application_start) add(findings, "warning", "phase_period_gap", key, `${previous.phase_id} and ${current.phase_id} have an uncovered period`);
    }
  }

  for (const burden of collections.burdens ?? []) {
    for (const legalBase of burden.legal_bases ?? []) auditSourceUrl(legalBase.source_url, burden.tax_id);
    const currentPhases = (burden.current_phases ?? []).map((id) => phases.get(id)).filter(Boolean);
    for (const phase of currentPhases) {
      if (phase.tax_id !== burden.tax_id) add(findings, "error", "burden_phase_tax_mismatch", burden.tax_id, `${phase.phase_id} belongs to ${phase.tax_id}`);
    }
    for (const changeId of burden.pending_changes ?? []) {
      const change = changes.get(changeId);
      if (change && !change.tax_ids.includes(burden.tax_id)) add(findings, "error", "burden_pending_change_mismatch", burden.tax_id, `${changeId} does not include ${burden.tax_id}`);
    }
    if (currentPhases.length > 0) {
      const derived = deriveBurdenStatus(currentPhases, asOf);
      const expected = burden.pending_changes?.length > 0 && derived === "active" ? "active_with_pending_change" : derived;
      if (burden.current_status !== expected) add(findings, "error", "burden_status_mismatch", burden.tax_id, `stored=${burden.current_status}, derived=${expected}`);
    }
    if (burden.current_status === "active_with_pending_change" && burden.pending_changes.length === 0) add(findings, "error", "missing_pending_change", burden.tax_id, "active_with_pending_change requires pending_changes");
  }

  const revenueKeys = new Map();
  for (const revenue of collections.revenues ?? []) {
    auditSourceUrl(revenue.source_url, revenue.record_id);
    if (["included_in_parent_total", "partial"].includes(revenue.value_status) && !revenue.evidence_gap_reason) add(findings, "error", "amount_scope_reason_missing", revenue.record_id, `${revenue.value_status} requires evidence_gap_reason`);
    if (revenue.period_start && revenue.fiscal_year && !revenue.period_start.startsWith(revenue.fiscal_year)) add(findings, "warning", "fiscal_period_mismatch", revenue.record_id, `${revenue.period_start} does not start in fiscal year ${revenue.fiscal_year}`);
    const key = [revenue.tax_id, revenue.period_start, revenue.period_end, revenue.amount_yen, revenue.accounting_basis, revenue.consolidation_scope].join("|");
    if (revenue.value_status === "available" && revenueKeys.has(key)) add(findings, "warning", "possible_amount_double_count", revenue.record_id, `same amount and aggregation scope as ${revenueKeys.get(key)}`);
    else if (revenue.value_status === "available") revenueKeys.set(key, revenue.record_id);
  }

  for (const event of collections.events ?? []) auditSourceUrl(event.source_url, event.event_id);

  return findings;
}
