import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../adapters/schema-validator.js";
import { buildRuntimeMonitoringPlan } from "./build-monitoring-config.js";
import { buildMonitoringExecutionPlan, validateExecutionCoverage } from "./build-monitoring-execution-plan.js";
import { writeJsonAtomic } from "../adapters/filesystem-store.js";

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function auditAdapterCoverage(root, { batchId } = {}) {
  const [inventory, monitoring, sources] = await Promise.all([
    buildMonitoringExecutionPlan(root),
    buildRuntimeMonitoringPlan(root),
    readYaml(join(root, "config/sources.yaml"))
  ]);
  const errors = validateExecutionCoverage(inventory, monitoring);
  const sourceById = new Map(sources.sources.map((source) => [source.source_id, source]));
  const monitoringById = new Map(monitoring.targets.map((target) => [target.tax_id, target]));
  const targets = batchId ? inventory.targets.filter(({ batch_id: id }) => id === batchId) : inventory.targets;
  if (batchId && targets.length === 0) errors.push(`${batchId}: batch is missing`);

  const rows = [];
  for (const target of targets) {
    const implementedSources = target.sources.filter(({ adapter_status }) => adapter_status === "implemented");
    const heldSources = target.sources.filter(({ adapter_status }) => adapter_status === "held");
    if (target.implementation_status === "implemented" && implementedSources.length === 0) errors.push(`${target.tax_id}: implemented target has no implemented source`);
    if (target.implementation_status === "held" && heldSources.length === 0) errors.push(`${target.tax_id}: manual target has no held source`);
    for (const source of heldSources) if (!source.hold_reason || source.hold_reason.length < 20) errors.push(`${target.tax_id}/${source.target_id}: manual reason is missing`);
    for (const source of implementedSources) {
      if (source.official_format === "egov_law_api_json") continue;
      const configured = sourceById.get(source.source_id);
      if (!configured) { errors.push(`${target.tax_id}/${source.source_id}: source registry entry is missing`); continue; }
      for (const url of configured.entry_urls) {
        const fixture = join(root, "tests/fixtures/source-scan", basename(new URL(url).pathname));
        if (!await exists(fixture)) errors.push(`${target.tax_id}/${source.source_id}: fixture is missing for ${basename(new URL(url).pathname)}`);
      }
    }
    rows.push({
      tax_id: target.tax_id,
      batch_id: target.batch_id,
      municipal_scope: target.municipal_scope,
      monitoring_mode: monitoringById.get(target.tax_id)?.monitoring_mode,
      implementation_status: target.implementation_status,
      source_statuses: target.sources.map(({ source_id, adapter_status }) => ({ source_id, adapter_status }))
    });
  }
  const batches = [...new Set(inventory.targets.map(({ batch_id }) => batch_id))].sort().map((id) => {
    const members = inventory.targets.filter(({ batch_id }) => batch_id === id);
    const reuseGroups = new Set(members.map(({ reuse_group }) => reuse_group)).size;
    return { batch_id: id, targets: members.length, implemented: members.filter(({ implementation_status }) => implementation_status.startsWith("implemented")).length, manual: members.filter(({ implementation_status }) => implementation_status === "held").length, reuse_groups: reuseGroups, within_policy: members.length <= inventory.batch_policy.hard_max_targets || reuseGroups === 1 };
  });
  return {
    schema_version: 1,
    status: errors.length ? "error" : "clean",
    generated_at: inventory.generated_at,
    scope: batchId ?? "all",
    summary: {
      targets: rows.length,
      total_targets: inventory.targets.length,
      automated: rows.filter(({ monitoring_mode }) => monitoring_mode === "automated").length,
      manual: rows.filter(({ monitoring_mode }) => monitoring_mode === "manual").length,
      implemented_adapters: rows.filter(({ implementation_status }) => implementation_status.startsWith("implemented")).length,
      held_adapters: rows.filter(({ implementation_status }) => implementation_status === "held").length,
      issue_20: rows.filter(({ municipal_scope }) => municipal_scope === "issue_20").length,
      batches: batchId ? 1 : batches.length
    },
    batches: batchId ? batches.filter(({ batch_id }) => batch_id === batchId) : batches,
    targets: rows,
    errors
  };
}

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(`--${name}`); return index < 0 ? undefined : args[index + 1]; };
if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  const report = await auditAdapterCoverage(root, { batchId: option("batch") });
  if (option("output")) await writeJsonAtomic(option("output"), report);
  if (args.includes("--matrix")) console.log(JSON.stringify(report.batches.map(({ batch_id }) => batch_id)));
  else console.log(JSON.stringify({ status: report.status, ...report.summary, errors: report.errors }));
  if (report.status === "error") process.exitCode = 1;
}
