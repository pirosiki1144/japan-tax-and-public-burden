import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../validate/schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputPath = join(root, "config/monitoring.yaml");
const reviewPath = join(root, "docs/monitoring-extraction-target-review.md");
const GENERATED_AT = "2026-08-19T20:13:25+09:00";
const REVIEWED_EXTRACTION_TARGETS = {
  "consumption-tax": {
    "363AC0000000108": [
      "消費税法第1条・第2条：制度目的、課税資産・軽減対象課税資産等の定義",
      "消費税法第4条から第6条：課税対象、納税義務者、非課税",
      "消費税法第28条・第29条：課税標準、消費税率",
      "消費税法別表第1・第1の2：軽減税率対象"
    ],
    "6101.htm": [
      "法令等の確認基準日",
      "国内取引・外国貨物の課税対象",
      "標準税率・軽減税率と地方消費税の内訳",
      "非課税取引の扱い"
    ],
    "nta-consumption-tax-rates-page-2": [
      "法令等の確認基準日",
      "軽減税率制度の実施日",
      "標準税率・軽減税率と地方消費税の内訳",
      "軽減税率の対象品目・除外・判定時期"
    ]
  },
  "automobile-tax": {
    "325AC0000000226": [
      "地方税法第145条：自動車の定義",
      "地方税法第146条から第148条：納税義務者、みなし課税、非課税",
      "地方税法第154条：車種・用途・排気量等ごとの標準税率",
      "地方税法第155条から第158条：賦課期日、納期、月割、徴収方法"
    ]
  }
};

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
        extraction_targets: REVIEWED_EXTRACTION_TARGETS[burden.tax_id]?.[targetId(base)] ?? (base.article ? [`条文 ${base.article}`] : ["法令の改廃・施行状態（監視条文は#30の後続整備で確定）"])
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
          extraction_targets: REVIEWED_EXTRACTION_TARGETS[burden.tax_id][`${index === 0 ? "6101.htm" : `${nta.source_id}-page-${index + 1}`}`]
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
  const burdens = await readBurdens(repositoryRoot);
  const config = await buildMonitoringConfig(repositoryRoot);
  const names = new Map(burdens.map(({ tax_id, official_name }) => [tax_id, official_name]));
  const lines = [
    "# 監視抽出対象の設定候補",
    "",
    "- 対応Issue: #30（親Issue: #19）",
    `- 生成日時: ${GENERATED_AT}`,
    "- 対象: レビュー指定の消費税と自動車税",
    "- 確認方法: 公式リンクと、`config/monitoring.yaml`へ反映した監視文面候補を照合する。",
    "- 注意: チェック済みは設定への反映済みを表す。事実値を確定したことは意味せず、取得時に公式本文と構造を検証する。",
    ""
  ];
  for (const taxId of ["consumption-tax", "automobile-tax"]) {
    const target = config.targets.find(({ tax_id }) => tax_id === taxId);
    lines.push(`## ${names.get(taxId)} \`${taxId}\``, "");
    for (const source of target.sources) {
      lines.push(`参照先: [${source.source_id} / ${source.target_id}](${source.target_url})`, "");
      for (const extractionTarget of source.extraction_targets) lines.push(`- [x] ${extractionTarget}`);
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
