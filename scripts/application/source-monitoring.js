import { validatePorts } from "./strategy-registry.js";

export async function runSource({ root, sourceId, source: configuredSource, fetchImpl, now = () => new Date(), dryRun = false, ports }) {
  validatePorts(ports);
  const source = configuredSource ?? await ports.sourceRepository.loadEnabled(root, sourceId);
  const normalize = ports.sourceNormalizers.get(source.adapter);
  const pages = await ports.sourceReader.read(source, { fetchImpl, now });
  const fetches = pages.map(({ body: _body, bytes: _bytes, ...metadata }) => metadata);
  try {
    const normalized = await normalize(source, pages);
    const candidateDiff = await ports.canonicalRepository.diff(root, normalized);
    return { schema_version: 1, status: candidateDiff.length === 0 ? "no_change" : "change_detected", dry_run: dryRun, source_id: source.source_id, completed_at: now().toISOString(), fetches, normalized, candidate_diff: candidateDiff };
  } catch (error) {
    error.fetches = fetches;
    error.sourceUrl ??= source.entry_urls[0];
    throw error;
  }
}

export async function runSources({ root, sources, fetchImpl, now = () => new Date(), dryRun = false, ports }) {
  const results = [];
  for (const source of sources) {
    try {
      results.push(await runSource({ root, sourceId: source.source_id, source, fetchImpl, now, dryRun, ports }));
    } catch (error) {
      results.push({ schema_version: 1, status: "error", dry_run: dryRun, source_id: source.source_id, error_code: error.code ?? (error.message.includes("Source structure changed") ? "source_structure_changed" : "source_processing_failed"), error: error.message, retryable: error.retryable ?? false, attempts: error.attempts ?? 1, source_url: error.sourceUrl, fetches: error.fetches });
    }
  }
  return { schema_version: 1, status: results.some(({ status }) => status === "error") ? "error" : results.some(({ status }) => status === "change_detected") ? "change_detected" : "no_change", dry_run: dryRun, completed_at: now().toISOString(), results };
}

export async function runAllSources(options) {
  validatePorts(options.ports);
  const sources = await options.ports.sourceRepository.loadAutomated(options.root);
  if (sources.length === 0) throw new Error("No enabled automated sources are configured");
  return runSources({ ...options, sources });
}
