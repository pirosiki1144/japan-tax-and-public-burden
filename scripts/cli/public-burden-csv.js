import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeTextAtomic } from "../adapters/filesystem-store.js";
import { createValidators, validateDocument } from "../adapters/schema-validator.js";

export const DISTRIBUTION_HEADERS = ["distribution_row_id", "as_of", "time_classification", "public_burden_id", "public_burden_name", "component_id", "version_id", "component_name", "subject_conditions", "calculation_basis_id", "calculation_basis", "liable_party_id", "liable_party", "payment_obligors", "value_kind", "numeric_value", "unit", "acquisition_type", "source_fact_id", "calculation_set_id", "application_start", "application_end", "law_evidence", "cabinet_order_evidence", "ministerial_ordinance_evidence", "enforcement_regulation_evidence", "ordinance_evidence", "local_government_rule_evidence", "notice_evidence", "other_evidence", "master_verified_at"];

function duplicateIds(records, field) {
  const seen = new Set();
  return records.map((record) => record[field]).filter((id) => seen.has(id) || !seen.add(id));
}

function requireRef(index, id, location, errors) {
  if (!index.has(id)) errors.push(`${location}: unknown reference ${id}`);
}

export function validateMasterIntegrity(master) {
  const errors = [];
  const definitions = [
    [master.public_burdens, "public_burden_id"], [master.legal_sources, "legal_source_id"],
    [master.source_facts, "source_fact_id"], [master.calculation_sets, "calculation_set_id"], [master.burden_components, "component_id"]
  ];
  for (const [records, field] of definitions) for (const id of duplicateIds(records, field)) errors.push(`${field}: duplicate ID ${id}`);
  const burdens = new Set(master.public_burdens.map(({ public_burden_id }) => public_burden_id));
  const legalSources = new Set(master.legal_sources.map(({ legal_source_id }) => legal_source_id));
  const facts = new Map(master.source_facts.map((fact) => [fact.source_fact_id, fact]));
  const calculations = new Map(master.calculation_sets.map((set) => [set.calculation_set_id, set]));
  const components = new Set(master.burden_components.map(({ component_id }) => component_id));
  for (const source of master.legal_sources) for (const relation of source.relationships) requireRef(legalSources, relation.target_legal_source_id, `${source.legal_source_id}.relationships`, errors);
  for (const fact of master.source_facts) requireRef(legalSources, fact.legal_source_id, `${fact.source_fact_id}.legal_source_id`, errors);
  for (const set of master.calculation_sets) {
    set.input_source_fact_ids.forEach((id) => requireRef(facts, id, `${set.calculation_set_id}.input_source_fact_ids`, errors));
    set.output_component_ids.forEach((id) => requireRef(components, id, `${set.calculation_set_id}.output_component_ids`, errors));
    if (set.method === "explicit_allocation" && !set.allocation) errors.push(`${set.calculation_set_id}: explicit_allocation requires allocation`);
  }
  const versionIds = new Set();
  for (const component of master.burden_components) {
    requireRef(burdens, component.public_burden_id, `${component.component_id}.public_burden_id`, errors);
    for (const version of component.versions) {
      if (versionIds.has(version.version_id)) errors.push(`version_id: duplicate ID ${version.version_id}`);
      versionIds.add(version.version_id);
      version.legal_source_ids.forEach((id) => requireRef(legalSources, id, `${version.version_id}.legal_source_ids`, errors));
      if (version.application_start && version.application_end && version.application_start > version.application_end) errors.push(`${version.version_id}: application_start must not be after application_end`);
      if (version.value.acquisition_type === "direct") {
        requireRef(facts, version.value.source_fact_id, `${version.version_id}.source_fact_id`, errors);
        const fact = facts.get(version.value.source_fact_id);
        if (fact && (fact.normalized_value !== version.value.numeric_value || fact.unit !== version.value.unit)) errors.push(`${version.version_id}: direct value differs from source fact`);
      }
      else {
        requireRef(calculations, version.value.calculation_set_id, `${version.version_id}.calculation_set_id`, errors);
        const calculation = calculations.get(version.value.calculation_set_id);
        if (!calculation?.output_component_ids.includes(component.component_id)) errors.push(`${version.version_id}: calculation set does not output ${component.component_id}`);
        const inputs = calculation?.input_source_fact_ids.map((id) => facts.get(id)).filter(Boolean) ?? [];
        if (inputs.length === 1) {
          const expected = calculation.method === "equal_split"
            ? inputs[0].normalized_value / calculation.output_component_ids.length
            : inputs[0].normalized_value * calculation.allocation[component.component_id];
          if (calculation.rounding === "none" && Math.abs(expected - version.value.numeric_value) > Number.EPSILON) errors.push(`${version.version_id}: calculated value does not match ${calculation.calculation_set_id}`);
        }
      }
    }
  }
  return errors;
}

function timeClassification(version, asOf) {
  if (version.application_start && version.application_start > asOf) return "future";
  if (version.application_end && version.application_end < asOf) return "past";
  return "current";
}

function evidenceCell(source) {
  const dates = source.dates.map(({ event_type, date, date_raw }) => `${event_type}:${date ?? "unknown"} (${date_raw})`).join("; ");
  return [`${source.title}${source.item_number ? ` ${source.item_number}` : ""}`, source.item_text, dates, source.source_url].filter((value) => value !== null && value !== "").join("\n");
}

export function buildDistributionRows(master, asOf) {
  const burdens = new Map(master.public_burdens.map((record) => [record.public_burden_id, record]));
  const sources = new Map(master.legal_sources.map((record) => [record.legal_source_id, record]));
  const rows = [];
  for (const component of [...master.burden_components].sort((a, b) => a.component_id.localeCompare(b.component_id, "en"))) {
    for (const version of [...component.versions].sort((a, b) => a.version_id.localeCompare(b.version_id, "en"))) {
      const evidence = Object.fromEntries(["law", "cabinet_order", "ministerial_ordinance", "enforcement_regulation", "ordinance", "local_government_rule", "notice", "other"].map((type) => [`${type}_evidence`, version.legal_source_ids.map((id) => sources.get(id)).filter((source) => source?.source_type === type).sort((a, b) => a.legal_source_id.localeCompare(b.legal_source_id, "en")).map(evidenceCell).join("\n\n")]));
      for (const basis of version.calculation_bases) for (const party of version.liable_parties) rows.push({
        distribution_row_id: `${version.version_id}-${basis.calculation_basis_id}-${party.party_id}`,
        as_of: asOf, time_classification: timeClassification(version, asOf), public_burden_id: component.public_burden_id,
        public_burden_name: burdens.get(component.public_burden_id).name, component_id: component.component_id, version_id: version.version_id,
        component_name: component.name, subject_conditions: version.subject_conditions, calculation_basis_id: basis.calculation_basis_id,
        calculation_basis: basis.description, liable_party_id: party.party_id, liable_party: party.description,
        payment_obligors: [...version.payment_obligors].sort().join("\n"), value_kind: version.value.value_kind,
        numeric_value: version.value.numeric_value, unit: version.value.unit, acquisition_type: version.value.acquisition_type,
        source_fact_id: version.value.source_fact_id ?? "", calculation_set_id: version.value.calculation_set_id ?? "",
        application_start: version.application_start, application_end: version.application_end, ...evidence, master_verified_at: master.verified_at
      });
    }
  }
  return rows.sort((a, b) => a.distribution_row_id.localeCompare(b.distribution_row_id, "en"));
}

function cell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeDistributionCsv(rows) {
  return `${[DISTRIBUTION_HEADERS, ...rows.map((row) => DISTRIBUTION_HEADERS.map((header) => row[header] ?? ""))].map((row) => row.map(cell).join(",")).join("\n")}\n`;
}

export async function generatePublicBurdenCsv(root, { input, output, asOf, check = false }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`Invalid as-of date: ${asOf}`);
  const master = JSON.parse(await readFile(input, "utf8"));
  const validators = await createValidators({ master: join(root, "schemas/public-burden-master.schema.json"), row: join(root, "schemas/public-burden-distribution.schema.json") });
  const errors = [...validateDocument(validators.master, master, input), ...validateMasterIntegrity(master)];
  const rows = errors.length ? [] : buildDistributionRows(master, asOf);
  rows.forEach((row, index) => errors.push(...validateDocument(validators.row, row, `${output}[${index}]`)));
  const rowIds = rows.map(({ distribution_row_id }) => distribution_row_id);
  if (new Set(rowIds).size !== rowIds.length) errors.push("distribution_row_id: duplicate rows");
  if (errors.length) throw new Error(errors.join("\n"));
  const content = serializeDistributionCsv(rows);
  if (check) {
    if (await readFile(output, "utf8") !== content) throw new Error(`${output} is stale`);
  } else await writeTextAtomic(output, content);
  return { rows: rows.length, output };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => { if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1] ?? true]); return pairs; }, []));
  if (!args.input || !args.output || !args["as-of"]) throw new Error("--input, --output, and --as-of are required");
  const result = await generatePublicBurdenCsv(root, { input: join(root, args.input), output: join(root, args.output), asOf: args["as-of"], check: args.check === true });
  console.log(JSON.stringify({ status: args.check ? "clean" : "written", ...result }));
}
