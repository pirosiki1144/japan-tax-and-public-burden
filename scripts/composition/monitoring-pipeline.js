import { join } from "node:path";
import { auditSourceScan } from "../domain/source-scan-audit.js";
import { loadSemanticBaseline } from "./semantic-baseline.js";
import { createValidators, readYaml, validateDocument } from "../adapters/schema-validator.js";
import { buildRuntimeMonitoringPlan } from "../cli/build-monitoring-config.js";
import { buildMonitoringExecutionPlan } from "../cli/build-monitoring-execution-plan.js";
import { runAutomatedSources } from "./source-pipeline.js";
import { monitoringComposition } from "./monitoring-composition.js";

export function getSemanticAdapter(name) {
  return monitoringComposition().registries.semanticExtractors.get(name);
}

export async function loadOperationalJobs(root, { batchId } = {}) {
  const [inventory, monitoring] = await Promise.all([
    buildMonitoringExecutionPlan(root),
    buildRuntimeMonitoringPlan(root)
  ]);
  const validators = await createValidators({
    inventory: join(root, "schemas/monitoring-execution-plan.schema.json"),
    monitoring: join(root, "schemas/monitoring-runtime.schema.json")
  });
  const errors = [
    ...validateDocument(validators.inventory, inventory, "generated monitoring execution plan"),
    ...validateDocument(validators.monitoring, monitoring, "generated monitoring runtime plan")
  ];
  if (errors.length) throw new Error(`Monitoring registry is invalid: ${errors.join("; ")}`);

  const monitoringByTaxId = new Map(monitoring.targets.map((target) => [target.tax_id, target]));
  const jobs = [];
  for (const target of inventory.targets) {
    if (batchId && target.batch_id !== batchId) continue;
    // Sources with a concrete source adapter already run through sourceRunner.
    // The semantic job list is reserved for registry entries that still use the
    // manual source adapter and need the shared semantic pipeline.
    for (const source of target.sources.filter(({ adapter_status, current_adapter: currentAdapter, official_format: officialFormat }) => adapter_status === "implemented" && (currentAdapter === "manual" || officialFormat === "egov_law_api_json"))) {
      const monitoredTarget = monitoringByTaxId.get(target.tax_id);
      const monitoredSource = monitoredTarget?.sources.find(({ target_id: targetId }) => targetId === source.target_id);
      if (!monitoredSource) throw new Error(`${target.tax_id}/${source.target_id}: monitoring source is missing`);
      jobs.push({
        tax_id: target.tax_id,
        batch_id: target.batch_id,
        source_id: source.source_id,
        target_id: source.target_id,
        source_url: monitoredSource.target_url,
        adapter: source.required_adapter
      });
    }
  }
  return { inventory, monitoring, jobs };
}

function semanticError(job, error, dryRun) {
  return {
    schema_version: 1,
    status: "error",
    dry_run: dryRun,
    source_id: `semantic:${job.tax_id}:${job.target_id}`,
    tax_id: job.tax_id,
    batch_id: job.batch_id,
    target_id: job.target_id,
    adapter: job.adapter,
    error_code: error.code ?? (error.message.includes("matched") || error.message.includes("unreadable") ? "source_structure_changed" : "semantic_processing_failed"),
    error: error.message,
    retryable: error.retryable ?? false,
    source_url: error.sourceUrl ?? job.source_url,
    fetches: error.fetches ?? []
  };
}

export async function runOperationalMonitoring({
  root,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  dryRun = false,
  batchId,
  sourceRunner = runAutomatedSources,
  semanticRunner,
  semanticBaselinePath
}) {
  const { inventory, monitoring, jobs } = await loadOperationalJobs(root, { batchId });
  if (jobs.length === 0) throw new Error(batchId ? `No implemented adapter jobs in batch: ${batchId}` : "No implemented semantic adapter jobs are configured");

  const baseline = semanticRunner ? null : await loadSemanticBaseline(root, semanticBaselinePath);
  const sourceScan = await sourceRunner({ root, fetchImpl, now, dryRun });
  const semanticResults = [];
  const documentCache = new Map();
  for (const job of jobs) {
    try {
      const runner = semanticRunner ?? getSemanticAdapter(job.adapter);
      const extracted = await runner({ root, taxId: job.tax_id, job, fetchImpl, now, monitoring, baseline, documentCache });
      semanticResults.push({
        schema_version: 1,
        status: extracted.candidate_diff?.length ? "change_detected" : "no_change",
        dry_run: dryRun,
        source_id: `semantic:${job.tax_id}:${job.target_id}`,
        tax_id: job.tax_id,
        batch_id: job.batch_id,
        target_id: job.target_id,
        adapter: job.adapter,
        completed_at: now().toISOString(),
        fetches: extracted.fetches ?? [],
        normalized: extracted.record,
        candidate_diff: extracted.candidate_diff ?? []
      });
    } catch (error) {
      semanticResults.push(semanticError(job, error, dryRun));
    }
  }

  const results = [...sourceScan.results, ...semanticResults];
  const status = results.some(({ status: resultStatus }) => resultStatus === "error")
    ? "error"
    : results.some(({ status: resultStatus }) => resultStatus === "change_detected") ? "change_detected" : "no_change";
  const base = { schema_version: 1, status, dry_run: dryRun, completed_at: now().toISOString(), results };
  const audit = auditSourceScan(base);
  const mappedChanges = results.flatMap((result) => (result.candidate_diff ?? []).filter(({ target }) => target));
  const hasBlockingFinding = audit.findings.length > 0 || status === "error";
  return {
    ...base,
    registry: {
      targets_total: inventory.targets.length,
      semantic_jobs_run: jobs.length,
      batches_run: [...new Set(jobs.map(({ batch_id }) => batch_id))]
    },
    routing: {
      has_changes: mappedChanges.length > 0 && !hasBlockingFinding,
      has_findings: audit.findings.length > 0,
      pr_candidate_count: hasBlockingFinding ? 0 : mappedChanges.length,
      issue_candidate_count: audit.findings.length
    }
  };
}
