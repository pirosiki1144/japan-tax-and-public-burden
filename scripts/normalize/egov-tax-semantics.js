function flattenText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return (node.children ?? []).map(flattenText).join("");
}

function collect(node, predicate, matches = []) {
  if (!node || typeof node !== "object") return matches;
  if (predicate(node)) matches.push(node);
  for (const child of node.children ?? []) collect(child, predicate, matches);
  return matches;
}

function mainArticle(document, number) {
  const main = collect(document?.law_full_text, ({ tag }) => tag === "MainProvision");
  if (main.length !== 1) throw new Error(`Expected one MainProvision but found ${main.length}`);
  const articles = collect(main[0], (node) => node.tag === "Article" && node.attr?.Num === number);
  if (articles.length !== 1) throw new Error(`Article ${number} matched ${articles.length} nodes`);
  return articles[0];
}

function paragraphs(article) {
  return (article.children ?? []).filter(({ tag }) => tag === "Paragraph");
}

function japaneseInteger(raw) {
  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const large = { 万: 10000, 億: 100000000 };
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of raw) {
    if (character in digits) digit = digits[character];
    else if (character === "十" || character === "百" || character === "千") {
      const unit = character === "十" ? 10 : character === "百" ? 100 : 1000;
      section += (digit || 1) * unit;
      digit = 0;
    } else if (character in large) {
      total += (section + digit || 1) * large[character];
      section = 0;
      digit = 0;
    } else throw new Error(`Unsupported Japanese numeral: ${raw}`);
  }
  return total + section + digit;
}

function japaneseRate(raw) {
  const [integer, decimal] = raw.split("・");
  const decimalDigits = decimal ? [...decimal].map((character) => japaneseInteger(character)).join("") : "";
  return Number(`${japaneseInteger(integer)}${decimalDigits ? `.${decimalDigits}` : ""}`);
}

function metadata(document, taxId, sourceUrl) {
  const values = {
    schema_version: 1,
    tax_id: taxId,
    law_id: document?.law_info?.law_id,
    law_title: document?.revision_info?.law_title,
    revision_id: document?.revision_info?.law_revision_id,
    updated_at: document?.revision_info?.updated,
    source_url: sourceUrl
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") throw new Error(`Missing e-Gov metadata: ${key}`);
  }
  return values;
}

const nationalRoleMatchers = {
  taxpayer_rules: /納税義務者/,
  taxable_scope_rules: /課税物件|課税所得の範囲/,
  tax_base_rules: /課税標準/,
  rates: /税率/
};

function articleCaption(article) {
  return flattenText((article.children ?? []).find(({ tag }) => tag === "ArticleCaption"));
}

function semanticArticles(document, matcher, role) {
  const main = collect(document?.law_full_text, ({ tag }) => tag === "MainProvision");
  if (main.length !== 1) throw new Error(`Expected one MainProvision but found ${main.length}`);
  const matches = collect(main[0], ({ tag }) => tag === "Article")
    .filter((article) => matcher.test(articleCaption(article)))
    .filter((article) => role !== "tax_base_rules" || !/申告|認定|端数/.test(articleCaption(article)))
    .map((article) => ({ article_num: article.attr?.Num, caption: articleCaption(article), raw: flattenText(article) }));
  if (matches.length === 0) throw new Error(`${role} matched 0 MainProvision articles`);
  return matches;
}

export function extractGenericNationalTaxSemantics(document, taxId, sourceUrl) {
  const record = metadata(document, taxId, sourceUrl);
  for (const [role, matcher] of Object.entries(nationalRoleMatchers)) record[role] = semanticArticles(document, matcher, role);
  const revision = document.revision_info ?? {};
  record.applicable_period = {
    promulgation_date: document.law_info?.promulgation_date ?? null,
    amendment_promulgate_date: revision.amendment_promulgate_date ?? null,
    amendment_enforcement_date: revision.amendment_enforcement_date ?? null,
    scheduled_enforcement_date: revision.amendment_scheduled_enforcement_date ?? null,
    current_revision_status: revision.current_revision_status ?? null
  };
  return record;
}

export function extractConfiguredLocalTaxSemantics(document, taxId, sourceUrl, profile) {
  const record = metadata(document, taxId, sourceUrl);
  for (const [role, numbers] of Object.entries(profile.articles)) {
    record[role] = numbers.map((number) => {
      const article = mainArticle(document, number);
      return { article_num: number, caption: articleCaption(article), raw: flattenText(article) };
    });
  }
  const revision = document.revision_info ?? {};
  record.value_scope = "national_law_standard_or_limit";
  record.municipal_actual_value_included = false;
  record.applicable_period = {
    promulgation_date: document.law_info?.promulgation_date ?? null,
    amendment_promulgate_date: revision.amendment_promulgate_date ?? null,
    amendment_enforcement_date: revision.amendment_enforcement_date ?? null,
    scheduled_enforcement_date: revision.amendment_scheduled_enforcement_date ?? null,
    current_revision_status: revision.current_revision_status ?? null
  };
  return record;
}

function extractConsumptionTax(document, sourceUrl) {
  const liability = paragraphs(mainArticle(document, "5"));
  if (liability.length !== 2) throw new Error(`Consumption tax Article 5 expected 2 paragraphs but found ${liability.length}`);
  const scope = paragraphs(mainArticle(document, "4"));
  const bases = paragraphs(mainArticle(document, "28"));
  const rateItems = collect(mainArticle(document, "29"), ({ tag }) => tag === "Item");
  if (rateItems.length !== 2) throw new Error(`Consumption tax Article 29 expected 2 items but found ${rateItems.length}`);
  const rates = rateItems.map((item, index) => {
    const raw = flattenText(item);
    const match = raw.match(/百分の([一二三四五六七八九十・]+)/);
    if (!match) throw new Error(`Consumption tax Article 29 item ${index + 1} rate is unreadable`);
    return {
      rate_type: index === 0 ? "standard" : "reduced",
      value: japaneseRate(match[1]),
      unit: "percent",
      article_num: "29",
      item_num: String(index + 1),
      raw
    };
  });
  return {
    ...metadata(document, "consumption-tax", sourceUrl),
    taxpayer_rules: liability.map((node, index) => ({ role: index === 0 ? "business_operator" : "bonded_goods_withdrawer", article_num: "5", paragraph_num: String(index + 1), raw: flattenText(node) })),
    taxable_scope_rules: scope.map((node) => ({ article_num: "4", paragraph_num: node.attr?.Num, raw: flattenText(node) })),
    tax_base_rules: bases.map((node) => ({ article_num: "28", paragraph_num: node.attr?.Num, raw: flattenText(node) })),
    rates
  };
}

function parseAutomobileRates(article) {
  const rows = collect(article, ({ tag }) => tag === "TableRow");
  if (rows.length === 0) throw new Error("Automobile tax Article 154 rate table is missing");
  const path = [];
  const rates = [];
  for (const row of rows) {
    const columns = (row.children ?? []).filter(({ tag }) => tag === "TableColumn").map(flattenText).map((value) => value.trim());
    const nonEmpty = columns.filter(Boolean);
    if (nonEmpty.length === 0) continue;
    const label = nonEmpty[0];
    const annualIndex = nonEmpty.indexOf("年額");
    if (annualIndex < 0) {
      if (/^[一二三四]\s/.test(label)) path.splice(0, path.length, label);
      else if (/^[イロハニ]\s/.test(label)) path.splice(1, path.length, label);
      else if (/^（[０-９0-9]+）/.test(label)) path.splice(2, path.length, label);
      else throw new Error(`Automobile tax Article 154 heading is unreadable: ${label}`);
      continue;
    }
    const amountRaw = nonEmpty.at(-1);
    const exact = amountRaw.match(/^([一二三四五六七八九十百千万億]+)円$/);
    rates.push({
      category_path: [...path],
      condition: label,
      amount_yen: exact ? japaneseInteger(exact[1]) : null,
      amount_raw: amountRaw,
      period: "annual",
      article_num: "154"
    });
  }
  if (rates.length === 0) throw new Error("Automobile tax Article 154 contained no rate rows");
  return rates;
}

function extractAutomobileTax(document, sourceUrl) {
  const liability = paragraphs(mainArticle(document, "146"));
  if (liability.length !== 2) throw new Error(`Automobile tax Article 146 expected 2 paragraphs but found ${liability.length}`);
  const rateArticle = mainArticle(document, "154");
  const adjustmentRules = paragraphs(rateArticle).filter(({ attr }) => Number(attr?.Num) >= 2).map((node) => ({ article_num: "154", paragraph_num: node.attr.Num, raw: flattenText(node) }));
  return {
    ...metadata(document, "automobile-tax", sourceUrl),
    taxpayer_rules: liability.map((node, index) => ({ role: index === 0 ? "owner" : "user_when_owner_exempt", article_num: "146", paragraph_num: String(index + 1), raw: flattenText(node) })),
    rates: parseAutomobileRates(rateArticle),
    rate_adjustment_rules: adjustmentRules
  };
}

export function extractEgovTaxSemantics(document, taxId, sourceUrl) {
  if (taxId === "consumption-tax") return extractConsumptionTax(document, sourceUrl);
  if (taxId === "automobile-tax") return extractAutomobileTax(document, sourceUrl);
  throw new Error(`Unsupported semantic extraction target: ${taxId}`);
}

export function diffSemanticValues(previous, current) {
  const changes = [];
  const visit = (before, after, path) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (Array.isArray(before) && Array.isArray(after) || before && after && typeof before === "object" && typeof after === "object") {
      const keys = new Set(Array.isArray(before) ? [...before.keys(), ...after.keys()] : [...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys) visit(before?.[key], after?.[key], `${path}${Array.isArray(before) ? `[${key}]` : `${path ? "." : ""}${key}`}`);
      return;
    }
    changes.push({ path, old_value: before ?? null, new_value: after ?? null });
  };
  visit(previous, current, "");
  return changes;
}
