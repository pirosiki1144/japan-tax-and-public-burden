import { loadEnabledSource } from "../fetch/source-registry.js";
import { fetchSourcePages } from "../fetch/http-fetcher.js";
import { validateNormalizedSource } from "../normalize/normalized-source-validator.js";
import { detectCanonicalDiff } from "../diff/canonical-diff.js";
import { getSourceAdapter } from "./source-adapters.js";

export async function runSourcePipeline({ root, sourceId, fetchImpl, now = () => new Date(), dryRun = false }) {
  const source = await loadEnabledSource(root, sourceId);
  const adapter = getSourceAdapter(source.adapter);
  const pages = await fetchSourcePages(source, { fetchImpl, now });
  const normalized = validateNormalizedSource(adapter.normalize(source, pages));
  const candidateDiff = await detectCanonicalDiff(root, normalized);
  return {
    schema_version: 1,
    status: candidateDiff.length === 0 ? "no_change" : "change_detected",
    dry_run: dryRun,
    source_id: source.source_id,
    completed_at: now().toISOString(),
    fetches: pages.map(({ body: _body, ...metadata }) => metadata),
    normalized,
    candidate_diff: candidateDiff
  };
}
