import { join } from "node:path";
import { auditSourceScan } from "../audit/source-scan-audit.js";
import { extractConfiguredSemanticTarget } from "../monitoring/extract-egov-tax-semantics.js";
import { diffAgainstSemanticBaseline, loadSemanticBaseline } from "../monitoring/semantic-baseline.js";
import { createValidators, readYaml, validateDocument } from "../validate/schema-validator.js";
import { runAutomatedSources } from "./source-pipeline.js";

const semanticAdapters = new Map([
  ["egov_law_semantics", async ({ root, taxId, fetchImpl, now, monitoring, baseline }) => {
    const extracted = await extractConfiguredSemanticTarget(root, taxId, { fetchImpl, now, monitoring });
    return { ...extracted, candidate_diff: diffAgainstSemanticBaseline(extracted.record, baseline) };
  }]
]);

export function getSemanticAdapter(name) {
  const adapter = semanticAdapters.get(name);
  if (!adapter) throw new Error(`No registered semantic adapter: ${name}`);
  return adapter;
}

export async function loadOperationalJobs(root, { batchId } = {}) {
  const [inventory, monitoring] = await Promise.all([
    readYaml(join(root, "config/adapter-inventory.yaml")),
    readYaml(join(root, "config/monitoring.yaml"))
  ]);
  const validators = await createValidators({
    inventory: join(root, "schemas/adapter-inventory.schema.json"),
    monitoring: join(root, "schemas/monitoring.schema.json")
  });
  const errors = [
    ...validateDocument(validators.inventory, inventory, "config/adapter-inventory.yaml"),
    ...validateDocument(validators.monitoring, monitoring, "config/monitoring.yaml")
  ];
  if (errors.length) throw new Error(`Monitoring registry is invalid: ${errors.join("; ")}`);

  const monitoringByTaxId = new Map(monitoring.targets.map((target) => [target.tax_id, target]));
  const jobs = [];
  for (const target of inventory.targets) {
    if (batchId && target.batch_id !== batchId) continue;
    for (const source of target.sources.filter(({ adapter_status }) => adapter_status === "implemented")) {
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
  for (const job of jobs) {
    try {
      const runner = semanticRunner ?? getSemanticAdapter(job.adapter);
      const extracted = await runner({ root, taxId: job.tax_id, job, fetchImpl, now, monitoring, baseline });
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
