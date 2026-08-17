import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deriveBurdenStatus } from "../normalize/derive-status.js";
import { validateRepository } from "../validate/repository-validator.js";
import { createValidators, readYaml, validateDocument } from "../validate/schema-validator.js";

export const ARTIFACT_NAMES = ["current.csv", "current.json", "history.csv", "history.json", "summary.csv", "summary.json"];

const CURRENT_HEADERS = ["as_of", "tax_id", "official_name", "burden_type", "jurisdiction", "current_status", "canonical_current_status", "coverage_status", "phase_id", "change_id", "subject_scope", "value_kind", "numeric_value", "unit", "value_raw", "value_status", "value_scope", "application_start", "application_end", "collection_start", "collection_end", "source_refs", "verified_at"];
const HISTORY_HEADERS = ["record_type", "record_id", "tax_id", "change_id", "event_or_phase_type", "effective_date", "end_date", "value_kind", "numeric_value_or_amount_yen", "unit", "value_status", "period_or_scope", "accounting_basis", "consolidation_scope", "source_urls", "verified_or_observed_at", "payload_json"];
const SUMMARY_HEADERS = ["tax_id", "fiscal_year", "amount_kind", "accounting_basis", "government_level", "account_or_fund", "gross_or_net", "refund_treatment", "consolidation_scope", "amount_yen", "included_record_ids", "excluded_inner_record_ids", "unavailable_record_ids"];

function sortBy(records, field) {
  return [...records].sort((left, right) => String(left[field]).localeCompare(String(right[field]), "en"));
}

function json(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers, rows) {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function isActive(phase, asOf) {
  return phase.application_start !== null && phase.application_start <= asOf && (phase.application_end === null || phase.application_end >= asOf);
}

function collectUrls(value, urls = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => collectUrls(item, urls));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "source_url" || key.endsWith("_url")) && typeof child === "string") urls.add(child);
      else if (key.endsWith("_urls") && Array.isArray(child)) child.filter((item) => typeof item === "string").forEach((item) => urls.add(item));
      else collectUrls(child, urls);
    }
  }
  return [...urls].sort();
}

function buildCurrent(collections, asOf) {
  const allPhases = sortBy(collections.phases, "phase_id");
  const changes = new Map(collections.changes.map((change) => [change.change_id, change]));
  const records = sortBy(collections.burdens, "tax_id").map((burden) => {
    const taxPhases = allPhases.filter(({ tax_id }) => tax_id === burden.tax_id);
    const status = taxPhases.length === 0 ? burden.current_status : deriveBurdenStatus(taxPhases, asOf);
    const futureChangeIds = [...new Set(taxPhases.filter(({ application_start }) => application_start !== null && application_start > asOf).map(({ change_id }) => change_id))].sort();
    return {
      tax_id: burden.tax_id,
      current_status: status,
      canonical_current_status: burden.current_status,
      burden,
      active_phases: taxPhases.filter((phase) => isActive(phase, asOf)),
      pending_changes: futureChangeIds.map((id) => changes.get(id)).filter(Boolean),
      canonical_pending_changes: burden.pending_changes.map((id) => changes.get(id)).filter(Boolean)
    };
  });
  return { schema_version: 1, dataset: "current", as_of: asOf, sources: sortBy(collections.sources, "source_id"), records };
}

function buildHistory(collections, asOf) {
  return {
    schema_version: 2,
    dataset: "history",
    as_of: asOf,
    sources: sortBy(collections.sources, "source_id"),
    burdens: sortBy(collections.burdens, "tax_id"),
    changes: sortBy(collections.changes, "change_id"),
    events: sortBy(collections.events, "event_id"),
    phases: sortBy(collections.phases, "phase_id"),
    revenue: sortBy(collections.revenues, "record_id"),
    national_burden_ratios: [...collections.ratios].sort((a, b) => `${a.fiscal_year}|${a.value_kind}`.localeCompare(`${b.fiscal_year}|${b.value_kind}`, "en")),
    national_burden_ratio_mappings: sortBy(collections.mappings, "mapping_id")
  };
}

function amountGroupKey(record) {
  return ["tax_id", "fiscal_year", "amount_kind", "accounting_basis", "government_level", "account_or_fund", "gross_or_net", "refund_treatment", "consolidation_scope"].map((field) => record[field]).join("|");
}

export function buildSummary(collections, asOf) {
  const groups = new Map();
  for (const record of sortBy(collections.revenues, "record_id")) {
    const key = amountGroupKey(record);
    if (!groups.has(key)) groups.set(key, {
      tax_id: record.tax_id,
      fiscal_year: record.fiscal_year,
      amount_kind: record.amount_kind,
      accounting_basis: record.accounting_basis,
      government_level: record.government_level,
      account_or_fund: record.account_or_fund,
      gross_or_net: record.gross_or_net,
      refund_treatment: record.refund_treatment,
      consolidation_scope: record.consolidation_scope,
      amount_yen: "0",
      included_record_ids: [],
      excluded_inner_record_ids: [],
      unavailable_record_ids: []
    });
    const group = groups.get(key);
    if (["available", "zero"].includes(record.value_status)) {
      group.amount_yen = (BigInt(group.amount_yen) + BigInt(record.amount_yen)).toString();
      group.included_record_ids.push(record.record_id);
    } else if (record.value_status === "included_in_parent_total") group.excluded_inner_record_ids.push(record.record_id);
    else group.unavailable_record_ids.push(record.record_id);
  }
  return {
    schema_version: 1,
    dataset: "summary",
    as_of: asOf,
    counts: {
      sources: collections.sources?.length ?? 0,
      burdens: collections.burdens.length,
      changes: collections.changes.length,
      events: collections.events.length,
      phases: collections.phases.length,
      revenue_records: collections.revenues.length
    },
    amount_groups: [...groups.values()]
  };
}

function currentRows(current) {
  return current.records.flatMap((record) => {
    const phases = record.active_phases.length > 0 ? record.active_phases : [null];
    return phases.map((phase) => ({
      as_of: current.as_of,
      tax_id: record.tax_id,
      official_name: record.burden.official_name,
      burden_type: record.burden.burden_type,
      jurisdiction: record.burden.jurisdiction,
      current_status: record.current_status,
      canonical_current_status: record.canonical_current_status,
      coverage_status: record.burden.coverage_status,
      phase_id: phase?.phase_id,
      change_id: phase?.change_id,
      subject_scope: phase?.subject_scope,
      value_kind: phase?.value.kind,
      numeric_value: phase?.value.numeric_value,
      unit: phase?.value.unit,
      value_raw: phase?.value.raw,
      value_status: phase?.value.value_status,
      value_scope: phase?.value.scope,
      application_start: phase?.application_start,
      application_end: phase?.application_end,
      collection_start: phase?.collection_start,
      collection_end: phase?.collection_end,
      source_refs: phase?.source_refs ?? record.burden.source_refs,
      verified_at: phase?.verified_at ?? record.burden.verified_at
    }));
  });
}

function historyRows(history) {
  const rows = [];
  const push = (recordType, id, record, fields = {}) => rows.push({
    record_type: recordType,
    record_id: id,
    tax_id: fields.tax_id,
    change_id: fields.change_id,
    event_or_phase_type: fields.type,
    effective_date: fields.effective,
    end_date: fields.end,
    value_kind: fields.value_kind,
    numeric_value_or_amount_yen: fields.amount,
    unit: fields.unit,
    value_status: fields.value_status,
    period_or_scope: fields.scope,
    accounting_basis: fields.accounting_basis,
    consolidation_scope: fields.consolidation_scope,
    source_urls: collectUrls(record),
    verified_or_observed_at: record.verified_at ?? record.observed_at,
    payload_json: JSON.stringify(record)
  });
  history.sources.forEach((record) => push("source", record.source_id, record, { type: record.source_type, value_status: record.enabled ? "enabled" : "disabled" }));
  history.burdens.forEach((record) => push("burden", record.tax_id, record, { tax_id: record.tax_id, type: record.current_status, value_status: record.coverage_status }));
  history.changes.forEach((record) => push("change", record.change_id, record, { tax_id: record.tax_ids, change_id: record.change_id, type: record.current_stage, value_status: record.stage_confidence }));
  history.events.forEach((record) => push("event", record.event_id, record, { change_id: record.change_id, type: record.event_type, effective: record.event_date, value_status: record.confidence }));
  history.phases.forEach((record) => push("phase", record.phase_id, record, { tax_id: record.tax_id, change_id: record.change_id, type: `phase-${record.phase_sequence}`, effective: record.application_start, end: record.application_end, value_kind: record.value.kind, amount: record.value.numeric_value, unit: record.value.unit, value_status: record.value.value_status, scope: record.value.scope }));
  history.revenue.forEach((record) => push("revenue", record.record_id, record, { tax_id: record.tax_id, type: record.amount_kind, effective: record.period_start, end: record.period_end, amount: record.amount_yen, unit: "yen", value_status: record.value_status, scope: record.account_or_fund, accounting_basis: record.accounting_basis, consolidation_scope: record.consolidation_scope }));
  history.national_burden_ratios.forEach((record) => push("national_burden_ratio", `${record.fiscal_year}-${record.value_kind}`, record, { type: record.value_kind, effective: record.fiscal_year, value_status: record.value_kind }));
  history.national_burden_ratio_mappings.forEach((record) => push("national_burden_ratio_mapping", record.mapping_id, record, { tax_id: record.tax_id, type: record.status }));
  return rows;
}

async function validateGenerated(root, current, history, summary) {
  const validators = await createValidators({
    current: join(root, "schemas/distribution-current.schema.json"),
    history: join(root, "schemas/distribution-history.schema.json"),
    summary: join(root, "schemas/distribution-summary.schema.json")
  });
  const errors = [
    ...validateDocument(validators.current, current, "generated/current.json"),
    ...validateDocument(validators.history, history, "generated/history.json"),
    ...validateDocument(validators.summary, summary, "generated/summary.json")
  ];
  if (errors.length > 0) throw new Error(`Generated artifact schema validation failed:\n${errors.join("\n")}`);
}

export async function buildDistributionArtifacts(root, { asOf } = {}) {
  const configuration = await readYaml(join(root, "config/distribution.yaml"));
  const effectiveDate = asOf ?? configuration.default_as_of;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error(`Invalid as-of date: ${effectiveDate}`);
  const { errors, collections } = await validateRepository(root);
  if (errors.length > 0) throw new Error(`Canonical data validation failed:\n${errors.join("\n")}`);
  const current = buildCurrent(collections, effectiveDate);
  const history = buildHistory(collections, effectiveDate);
  const summary = buildSummary(collections, effectiveDate);
  await validateGenerated(root, current, history, summary);
  return new Map([
    ["current.csv", csv(CURRENT_HEADERS, currentRows(current))],
    ["current.json", json(current)],
    ["history.csv", csv(HISTORY_HEADERS, historyRows(history))],
    ["history.json", json(history)],
    ["summary.csv", csv(SUMMARY_HEADERS, summary.amount_groups)],
    ["summary.json", json(summary)]
  ]);
}

export function compareArtifactSets(expected, actual) {
  const differences = [];
  const names = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  for (const name of names) {
    if (!expected.has(name)) differences.push(`${name}: unexpected file`);
    else if (!actual.has(name)) differences.push(`${name}: missing file`);
    else if (expected.get(name) !== actual.get(name)) differences.push(`${name}: content differs`);
  }
  return differences;
}
