function textFromHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#37;|&percnt;/gi, "%")
    .replace(/\s+/g, " ")
    .trim();
}

function compile(pattern, label) {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid extraction pattern for ${label}: ${error.message}`);
  }
}

const transforms = {
  string: (raw) => raw,
  number: (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Extracted value is not a finite number: ${raw}`);
    return value;
  },
  japanese_date: (raw) => {
    const match = raw.match(/^令和(元|[0-9]+)年([0-9]+)月([0-9]+)日$/);
    if (!match) throw new Error(`Unsupported Japanese date: ${raw}`);
    const year = match[1] === "元" ? 2019 : 2018 + Number(match[1]);
    return `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
};

export function normalizeHtmlRegexFacts(source, pages) {
  const extraction = source.extraction;
  if (pages.length !== extraction.expected_pages) {
    throw new Error(`Source structure changed: expected ${extraction.expected_pages} configured pages but found ${pages.length}`);
  }
  const texts = pages.map(({ body }) => textFromHtml(body));
  for (const marker of extraction.required_markers) {
    if (!texts[marker.page_index] || !compile(marker.pattern, marker.label).test(texts[marker.page_index])) {
      throw new Error(`Source structure changed: ${marker.label} was not found`);
    }
  }
  const facts = extraction.facts.map((fact) => {
    const text = texts[fact.page_index];
    const match = text?.match(compile(fact.pattern, fact.fact_id));
    const raw = match?.[fact.capture_group];
    if (raw === undefined) throw new Error(`Source structure changed: ${fact.fact_id} was not found`);
    return { fact_id: fact.fact_id, raw, value: transforms[fact.transform](raw), expected_value: fact.expected_value, target: fact.target };
  });
  return { source_id: source.source_id, facts };
}
