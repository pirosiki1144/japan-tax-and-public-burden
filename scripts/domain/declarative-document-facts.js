const transforms = {
  string: (value) => value,
  number: (value) => {
    const normalized = Number(String(value).replaceAll(",", ""));
    if (!Number.isFinite(normalized)) throw new Error(`Extracted value is not a finite number: ${value}`);
    return normalized;
  }
};

function pattern(value, label) {
  try {
    return new RegExp(value);
  } catch (error) {
    throw new Error(`Invalid extraction pattern for ${label}: ${error.message}`);
  }
}

export function extractTextFacts(document, rules) {
  for (const marker of rules.required_markers ?? []) {
    if (!pattern(marker.pattern, marker.label).test(document.text)) {
      throw new Error(`Source structure changed: ${marker.label} was not found`);
    }
  }
  const facts = (rules.facts ?? []).map((fact) => {
    const matched = document.text.match(pattern(fact.pattern, fact.fact_id));
    const raw = matched?.[fact.capture_group ?? 1];
    if (raw === undefined) throw new Error(`Source structure changed: ${fact.fact_id} was not found`);
    return { fact_id: fact.fact_id, raw, value: transforms[fact.transform ?? "string"](raw), target: fact.target ?? null };
  });
  return { facts, evidence: document.evidence };
}

export function extractCsvFacts(document, rules) {
  const facts = (rules.facts ?? []).map((fact) => {
    const matches = document.records.filter((record) => Object.entries(fact.match).every(([key, value]) => record[key] === value));
    if (matches.length !== 1) throw new Error(`Source structure changed: ${fact.fact_id} matched ${matches.length} CSV rows`);
    const raw = matches[0][fact.value_column];
    if (raw === undefined || raw === "") throw new Error(`Source structure changed: ${fact.fact_id} has no value`);
    return { fact_id: fact.fact_id, raw, value: transforms[fact.transform ?? "string"](raw), target: fact.target ?? null };
  });
  return { facts, evidence: document.evidence };
}
