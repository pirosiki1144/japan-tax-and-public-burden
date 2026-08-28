import { createStrategyRegistry, validateDocument, validateNormalizedFacts, validateSemanticExtraction, validateSourcePages } from "../application/strategy-registry.js";
import { runAllSources } from "../application/source-monitoring.js";
import { detectCanonicalDiff } from "../diff/canonical-diff.js";
import { fetchSourcePages } from "../fetch/http-fetcher.js";
import { loadAutomatedSources, loadEnabledSource } from "../fetch/source-registry.js";
import { adaptCsvDocument, adaptHtmlDocument, adaptPdfDocument } from "../formats/official-document.js";
import { extractConfiguredSemanticTarget } from "../monitoring/extract-egov-tax-semantics.js";
import { diffAgainstSemanticBaseline } from "../monitoring/semantic-baseline.js";
import { normalizeEgovLawArticleFacts } from "../normalize/egov-law-article-facts.js";
import { normalizeHtmlRegexFacts } from "../normalize/html-regex-facts.js";
import { validateNormalizedSource } from "../normalize/normalized-source-validator.js";
import { normalizePdfRegexFacts } from "../normalize/pdf-regex-facts.js";

function buildComposition() {
  const sourceReaders = createStrategyRegistry("source reader", validateSourcePages).register("http", fetchSourcePages);
  const documentParsers = createStrategyRegistry("document parser", validateDocument)
    .register("official_html_document", adaptHtmlDocument)
    .register("official_pdf_document", adaptPdfDocument)
    .register("official_csv_document", adaptCsvDocument);
  const sourceNormalizers = createStrategyRegistry("source normalizer", validateNormalizedFacts)
    .register("html_regex_facts", (source, pages) => validateNormalizedSource(normalizeHtmlRegexFacts(source, pages)))
    .register("egov_law_article_facts", (source, pages) => validateNormalizedSource(normalizeEgovLawArticleFacts(source, pages)))
    .register("pdf_regex_facts", async (source, pages) => validateNormalizedSource(await normalizePdfRegexFacts(source, pages, { parseDocument: documentParsers.get("official_pdf_document") })));
  const semanticExtractors = createStrategyRegistry("semantic extractor", validateSemanticExtraction)
    .register("egov_law_semantics", async ({ root, taxId, fetchImpl, now, monitoring, baseline, documentCache }) => {
      const extracted = await extractConfiguredSemanticTarget(root, taxId, { fetchImpl, now, monitoring, documentCache });
      return { ...extracted, candidate_diff: diffAgainstSemanticBaseline(extracted.record, baseline) };
    });
  const ports = Object.freeze({
    sourceRepository: Object.freeze({ loadEnabled: loadEnabledSource, loadAutomated: loadAutomatedSources }),
    sourceReader: Object.freeze({ read: sourceReaders.get("http") }),
    canonicalRepository: Object.freeze({ diff: detectCanonicalDiff }),
    sourceNormalizers
  });
  return Object.freeze({ ports, registries: Object.freeze({ sourceReaders, documentParsers, sourceNormalizers, semanticExtractors }), runAutomatedSources: (options) => runAllSources({ ...options, ports }) });
}

let composition;
export function monitoringComposition() {
  composition ??= buildComposition();
  return composition;
}
