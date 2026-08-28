import { adaptPdfDocument } from "../formats/official-document.js";

function compile(pattern, label) {
  try { return new RegExp(pattern); } catch (error) { throw new Error(`Invalid extraction pattern for ${label}: ${error.message}`); }
}

export async function normalizePdfRegexFacts(source, pages, { parseDocument = adaptPdfDocument } = {}) {
  if (pages.length !== source.extraction.expected_pages) throw new Error(`Source structure changed: expected ${source.extraction.expected_pages} configured pages but found ${pages.length}`);
  const documents = await Promise.all(pages.map((page) => parseDocument(page)));
  const texts = documents.map(({ text }) => text.normalize("NFKC").replace(/\s+/g, ""));
  for (const marker of source.extraction.required_markers) {
    if (!texts[marker.page_index] || !compile(marker.pattern, marker.label).test(texts[marker.page_index])) throw new Error(`Source structure changed: ${marker.label} was not found`);
  }
  const facts = source.extraction.facts.map((fact) => {
    const match = texts[fact.page_index]?.match(compile(fact.pattern, fact.fact_id));
    const raw = match?.[fact.capture_group];
    if (raw === undefined) throw new Error(`Source structure changed: ${fact.fact_id} was not found`);
    const value = fact.transform === "number" ? Number(raw) : fact.transform === "iso_date_components"
      ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
      : fact.transform === "fiscal_year_start" ? `${raw}-04-01`
      : fact.transform === "fiscal_year_end" ? `${Number(raw) + 1}-03-31`
      : raw;
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Source structure changed: ${fact.fact_id} is not numeric`);
    return { fact_id: fact.fact_id, raw, value, expected_value: fact.expected_value, target: fact.target };
  });
  return { source_id: source.source_id, facts };
}
