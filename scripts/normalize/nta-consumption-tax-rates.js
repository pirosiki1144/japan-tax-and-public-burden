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

function requireMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Source structure changed: ${label} was not found`);
  return match;
}

export function normalizeNtaConsumptionTaxRates(source, pages) {
  if (pages.length !== 2) throw new Error(`Source structure changed: expected 2 configured pages but found ${pages.length}`);
  const [overviewPage, ratesPage] = pages;
  const overview = textFromHtml(overviewPage.body);
  const rates = textFromHtml(ratesPage.body);
  requireMatch(overview, /標準税率10パーセント（うち2\.2パーセントは地方消費税）/, "overview rate statement");
  const start = requireMatch(rates, /(令和元年10月1日)から/, "application start")[1];
  const standard = requireMatch(rates, /標準税率は10パーセント（消費税率([0-9]+(?:\.[0-9]+)?)パーセント、地方消費税率2\.2パーセント）/, "standard rate");
  const reduced = requireMatch(rates, /軽減税率は8パーセント（消費税率([0-9]+(?:\.[0-9]+)?)パーセント、地方消費税率1\.76パーセント）/, "reduced rate");
  requireMatch(rates, /飲食料品（酒類を除く）/, "reduced-rate food scope");
  requireMatch(rates, /週2回以上発行/, "reduced-rate newspaper scope");

  return {
    source_id: source.source_id,
    tax_id: "consumption-tax",
    change_id: "consumption-tax-2019-rate",
    application_start: { date_value: "2019-10-01", date_raw: start },
    phases: [
      { phase_id: "consumption-tax-standard-rate-2019", numeric_value: Number(standard[1]), unit: "percent" },
      { phase_id: "consumption-tax-reduced-rate-2019", numeric_value: Number(reduced[1]), unit: "percent" }
    ]
  };
}
