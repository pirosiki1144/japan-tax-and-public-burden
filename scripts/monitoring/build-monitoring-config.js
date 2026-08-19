import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../validate/schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputPath = join(root, "config/monitoring.yaml");
const reviewPath = join(root, "docs/monitoring-extraction-target-review.md");
const GENERATED_AT = "2026-08-19T20:13:25+09:00";

function sourceForUrl(sources, url) {
  return sources.find(({ base_url }) => url.startsWith(base_url));
}

function targetId(base) {
  return base.law_id ?? base.source_url.split("/").filter(Boolean).at(-1);
}

async function readBurdens(repositoryRoot) {
  const burdens = [];
  for (const entry of await readdir(join(repositoryRoot, "data/burdens"), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:json|ya?ml)$/.test(entry.name)) continue;
    const document = await readYaml(join(repositoryRoot, "data/burdens", entry.name));
    burdens.push(...(Array.isArray(document) ? document : [document]));
  }
  return burdens;
}

export async function buildMonitoringConfig(repositoryRoot) {
  const registry = await readYaml(join(repositoryRoot, "config/sources.yaml"));
  const burdens = await readBurdens(repositoryRoot);

  const targets = burdens.map((burden) => {
    const automated = burden.tax_id === "consumption-tax";
    const sources = burden.legal_bases.map((base) => {
      const registered = sourceForUrl(registry.sources, base.source_url);
      if (!registered) throw new Error(`${burden.tax_id}: no registered source for ${base.source_url}`);
      return {
        source_id: registered.source_id,
        target_url: base.source_url,
        enabled: true,
        adapter: automated ? registered.adapter : "manual",
        target_id: targetId(base),
        extraction_targets: base.article ? [`条文 ${base.article}`] : ["法令の改廃・施行状態（監視条文は#30の後続整備で確定）"]
      };
    });
    if (automated) {
      const nta = registry.sources.find(({ source_id }) => source_id === "nta-consumption-tax-rates");
      for (const [index, url] of nta.entry_urls.entries()) {
        if (sources.some(({ target_url }) => target_url === url)) continue;
        sources.push({
          source_id: nta.source_id,
          target_url: url,
          enabled: true,
          adapter: nta.adapter,
          target_id: `${nta.source_id}-page-${index + 1}`,
          extraction_targets: index === 0 ? ["納税義務者・負担者・標準税率"] : ["標準税率・軽減税率・適用対象・開始日"]
        });
      }
    }
    return {
      tax_id: burden.tax_id,
      monitoring_mode: automated ? "automated" : "manual",
      enabled: true,
      cadence: automated ? "daily" : "monthly",
      municipal_scope: burden.burden_type === "local_tax" ? "issue_20" : "national_only",
      sources,
      notes: burden.burden_type === "local_tax" ? "国法レベルのみ。自治体条例・公式サイト・個別税率は#20で扱う" : automated ? "実装済みadapterで自動監視する" : "公式URLは特定済みだが抽出adapter未実装のため手動確認する"
    };
  }).sort((left, right) => left.tax_id.localeCompare(right.tax_id, "en"));
  return { schema_version: 1, generated_at: GENERATED_AT, targets };
}

export async function buildExtractionTargetReview(repositoryRoot) {
  const burdens = (await readBurdens(repositoryRoot)).sort((left, right) => left.tax_id.localeCompare(right.tax_id, "en"));
  const lines = [
    "# 監視抽出対象の設定候補",
    "",
    "- 対応Issue: #30（親Issue: #19）",
    `- 生成日時: ${GENERATED_AT}`,
    "- 確認方法: 各公式リンクを開き、その制度について監視する項目にチェックを付ける。条文番号を特定できた場合はPRコメントで指定する。",
    "- 注意: チェック前の項目は候補であり、`config/monitoring.yaml` の確定設定ではない。日付や条文を推測で補完しない。",
    ""
  ];
  for (const burden of burdens) {
    const name = burden.official_name === "unknown" ? "正式名称未確認" : burden.official_name;
    lines.push(`## ${name} \`${burden.tax_id}\``, "");
    for (const base of burden.legal_bases) {
      const article = base.article ? `（現行候補: ${base.article}）` : "（対象条文未確定）";
      lines.push(`- 参照先: [${base.name}${article}](${base.source_url})`);
    }
    lines.push(
      "- [ ] 制度の定義・正式名称",
      "- [ ] 納付義務者・課税対象・負担者",
      "- [ ] 税率・金額・算定基礎・上限下限",
      "- [ ] 非課税・免除・減免・特例",
      "- [ ] 公布日・施行日・適用開始日・徴収開始日",
      "- [ ] 改廃状態・経過措置・段階適用",
      ""
    );
    if (burden.evidence_gaps.length > 0) {
      lines.push("正本に記録済みの根拠不足:", "");
      for (const gap of burden.evidence_gaps) lines.push(`- [ ] ${gap}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function run() {
  const check = process.argv.includes("--check");
  const content = `${JSON.stringify(await buildMonitoringConfig(root), null, 2)}\n`;
  const review = await buildExtractionTargetReview(root);
  if (check) {
    if (await readFile(outputPath, "utf8") !== content) throw new Error("config/monitoring.yaml differs from canonical burdens and sources");
    if (await readFile(reviewPath, "utf8") !== review) throw new Error("monitoring extraction target review differs from canonical burdens");
    console.log(JSON.stringify({ status: "clean", targets: JSON.parse(content).targets.length }));
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, outputPath);
  const temporaryReview = `${reviewPath}.tmp`;
  await writeFile(temporaryReview, review, "utf8");
  await rename(temporaryReview, reviewPath);
  console.log(JSON.stringify({ status: "generated", targets: JSON.parse(content).targets.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
