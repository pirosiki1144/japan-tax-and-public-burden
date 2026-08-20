import { loadAutomatedSources, loadEnabledSource } from "../fetch/source-registry.js";
import { fetchSourcePages } from "../fetch/http-fetcher.js";
import { validateNormalizedSource } from "../normalize/normalized-source-validator.js";
import { detectCanonicalDiff } from "../diff/canonical-diff.js";
import { getSourceAdapter } from "./source-adapters.js";

export async function runSourcePipeline({ root, sourceId, source: configuredSource, fetchImpl, now = () => new Date(), dryRun = false }) {
  const source = configuredSource ?? await loadEnabledSource(root, sourceId);
  const adapter = getSourceAdapter(source.adapter);
  const pages = await fetchSourcePages(source, { fetchImpl, now });
  const fetches = pages.map(({ body: _body, bytes: _bytes, ...metadata }) => metadata);
  try {
    const normalized = validateNormalizedSource(adapter.normalize(source, pages));
    const candidateDiff = await detectCanonicalDiff(root, normalized);
    return {
      schema_version: 1,
      status: candidateDiff.length === 0 ? "no_change" : "change_detected",
      dry_run: dryRun,
      source_id: source.source_id,
      completed_at: now().toISOString(),
      fetches,
      normalized,
      candidate_diff: candidateDiff
    };
  } catch (error) {
    error.fetches = fetches;
    error.sourceUrl ??= source.entry_urls[0];
    throw error;
  }
}

export async function runAutomatedSources({ root, fetchImpl, now = () => new Date(), dryRun = false }) {
  const sources = await loadAutomatedSources(root);
  if (sources.length === 0) throw new Error("No enabled automated sources are configured");
  return runConfiguredSources({ root, sources, fetchImpl, now, dryRun });
}

export async function runConfiguredSources({ root, sources, fetchImpl, now = () => new Date(), dryRun = false }) {
  const results = [];
  for (const source of sources) {
    try {
      results.push(await runSourcePipeline({ root, sourceId: source.source_id, source, fetchImpl, now, dryRun }));
    } catch (error) {
      results.push({
        schema_version: 1,
        status: "error",
        dry_run: dryRun,
        source_id: source.source_id,
        error_code: error.code ?? (error.message.includes("Source structure changed") ? "source_structure_changed" : "source_processing_failed"),
        error: error.message,
        retryable: error.retryable ?? false,
        attempts: error.attempts ?? 1,
        source_url: error.sourceUrl,
        fetches: error.fetches
      });
    }
  }
  return {
    schema_version: 1,
    status: results.some(({ status }) => status === "error") ? "error" : results.some(({ status }) => status === "change_detected") ? "change_detected" : "no_change",
    dry_run: dryRun,
    completed_at: now().toISOString(),
    results
  };
}
