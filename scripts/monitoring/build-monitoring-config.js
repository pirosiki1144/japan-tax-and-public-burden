import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../validate/schema-validator.js";
import { loadMonitoringRegistry, registryByTaxId } from "./monitoring-registry.js";
import { readText, writeTextAtomic } from "../adapters/filesystem-store.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const reviewPath = join(root, "docs/monitoring-extraction-target-review.md");
const REVIEWED_EXTRACTION_TARGETS = {
  "consumption-tax": {
    "363AC0000000108": [
      egovArticleTarget("consumption-tax-purpose-and-definitions", "消費税法第1条・第2条：制度目的、課税資産・軽減対象課税資産等の定義", ["1", "2"]),
      egovArticleTarget("consumption-tax-scope-liability-and-exemption", "消費税法第4条から第6条：課税対象、納税義務者、非課税", ["4", "5", "6"]),
      egovArticleTarget("consumption-tax-base-and-rate", "消費税法第28条・第29条：課税標準、消費税率", ["28", "29"])
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
      egovArticleTarget("automobile-tax-definition", "地方税法第145条：自動車の定義", ["145"]),
      egovArticleTarget("automobile-tax-liability-and-exemption", "地方税法第146条から第148条：納税義務者、みなし課税、非課税", ["146", "147", "148"]),
      egovArticleTarget("automobile-tax-standard-rates", "地方税法第154条：車種・用途・排気量等ごとの標準税率", ["154"]),
      egovArticleTarget("automobile-tax-assessment-and-collection", "地方税法第155条から第158条：賦課期日、納期、月割、徴収方法", ["155", "156", "157", "158"])
    ]
  }
};

function egovArticleTarget(targetId, description, values) {
  return {
    target_id: targetId,
    description,
    selector: { root_path: "/law_full_text", scope_tag: "MainProvision", tag: "Article", attribute: "Num", values },
    comparison: "canonical_json_sha256"
  };
}

const EGOV_CHANGE_DETECTION = {
  document_format: "egov_law_api_v2_json",
  revision_id_path: "/revision_info/law_revision_id",
  updated_at_path: "/revision_info/updated",
  comparison: "selected_nodes_sha256"
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

export async function buildRuntimeMonitoringPlan(repositoryRoot) {
  const [sourcesRegistry, burdens, monitoringRegistry] = await Promise.all([
    readYaml(join(repositoryRoot, "config/sources.yaml")),
    readBurdens(repositoryRoot),
    loadMonitoringRegistry(repositoryRoot)
  ]);
  const decisions = registryByTaxId(monitoringRegistry);

  const targets = burdens.map((burden) => {
    const decision = decisions.get(burden.tax_id);
    if (!decision) throw new Error(`${burden.tax_id}: canonical monitoring decision is missing`);
    const automated = decision.monitoring_mode === "automated";
    const sources = burden.legal_bases.map((base) => {
      const registered = sourceForUrl(sourcesRegistry.sources, base.source_url);
      if (!registered) throw new Error(`${burden.tax_id}: no registered source for ${base.source_url}`);
      const extractionTargets = REVIEWED_EXTRACTION_TARGETS[burden.tax_id]?.[targetId(base)] ?? (base.article ? [`条文 ${base.article}`] : ["法令の改廃・施行状態（監視条文は#30の後続整備で確定）"]);
      const structured = extractionTargets.every((target) => typeof target === "object");
      return {
        source_id: registered.source_id,
        target_url: base.source_url,
        enabled: true,
        adapter: automated ? registered.adapter : "manual",
        target_id: targetId(base),
        ...(structured ? { change_detection: EGOV_CHANGE_DETECTION } : {}),
        extraction_targets: extractionTargets
      };
    });
    if (automated) {
      const supplementalSources = sourcesRegistry.sources.filter(({ monitoring_tax_ids: taxIds = [] }) => taxIds.includes(burden.tax_id));
      if (burden.tax_id === "consumption-tax") supplementalSources.push(sourcesRegistry.sources.find(({ source_id }) => source_id === "nta-consumption-tax-rates"));
      for (const supplemental of supplementalSources) {
        for (const [index, url] of supplemental.entry_urls.entries()) {
          if (sources.some(({ target_url }) => target_url === url)) continue;
          sources.push({
            source_id: supplemental.source_id,
            target_url: url,
            enabled: true,
            adapter: supplemental.adapter,
            target_id: `${supplemental.source_id}-page-${index + 1}`,
            extraction_targets: burden.tax_id === "consumption-tax"
              ? REVIEWED_EXTRACTION_TARGETS[burden.tax_id][`${index === 0 ? "6101.htm" : `${supplemental.source_id}-page-${index + 1}`}`]
              : [supplemental.scope]
          });
        }
      }
    }
    return {
      tax_id: burden.tax_id,
      monitoring_mode: automated ? "automated" : "manual",
      enabled: true,
      cadence: decision.cadence,
      municipal_scope: decision.municipal_scope,
      sources,
      notes: burden.burden_type === "local_tax" ? "国法レベルのみ。自治体条例・公式サイト・個別税率は#20で扱う" : decision.implementation_issue === 44 && automated ? "実装済みadapterで年次監視する。固定年度資料の次年度URLは公式一覧ページを手動確認して更新する" : decision.implementation_issue === 45 && automated ? "#45の実装済みadapterで月次監視する。概要ページにない適用開始日は推測しない" : automated ? "実装済みadapterで自動監視する" : "公式URLは特定済みだが抽出adapter未実装のため手動確認する"
    };
  }).sort((left, right) => left.tax_id.localeCompare(right.tax_id, "en"));
  return { schema_version: 1, generated_at: monitoringRegistry.metadata.monitoring_generated_at, targets };
}

export async function buildExtractionTargetReview(repositoryRoot) {
  const burdens = await readBurdens(repositoryRoot);
  const config = await buildRuntimeMonitoringPlan(repositoryRoot);
  const names = new Map(burdens.map(({ tax_id, official_name }) => [tax_id, official_name]));
  const lines = [
    "# 監視抽出対象の設定候補",
    "",
    "- 対応Issue: #30（親Issue: #19）",
    `- 生成日時: ${config.generated_at}`,
    "- 対象: レビュー指定の消費税と自動車税",
    "- 確認方法: 公式リンクと、`config/monitoring.yaml`から生成したruntime planの監視文面候補を照合する。",
    "- 注意: チェック済みは設定への反映済みを表す。事実値を確定したことは意味せず、取得時に公式本文と構造を検証する。",
    "- 後続: 納税義務者・課税対象・課税標準・税率の値抽出とCIは#39、定期運用とPR／Issue連携は#31で扱う。",
    ""
  ];
  for (const taxId of ["consumption-tax", "automobile-tax"]) {
    const target = config.targets.find(({ tax_id }) => tax_id === taxId);
    lines.push(`## ${names.get(taxId)} \`${taxId}\``, "");
    for (const source of target.sources) {
      lines.push(`参照先: [${source.source_id} / ${source.target_id}](${source.target_url})`, "");
      if (source.change_detection) {
        lines.push(`- 改訂判定: \`${source.change_detection.revision_id_path}\` と \`${source.change_detection.updated_at_path}\``);
        lines.push(`- 本文比較: \`${source.change_detection.comparison}\``);
      }
      for (const extractionTarget of source.extraction_targets) {
        const description = typeof extractionTarget === "string" ? extractionTarget : extractionTarget.description;
        const selector = typeof extractionTarget === "string" ? "" : `（\`${extractionTarget.selector.scope_tag} > ${extractionTarget.selector.tag}.attr.${extractionTarget.selector.attribute}\` = ${extractionTarget.selector.values.map((value) => `\`${value}\``).join(", ")}）`;
        lines.push(`- [x] ${description}${selector}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function run() {
  const check = process.argv.includes("--check");
  await loadMonitoringRegistry(root);
  const monitoring = await buildRuntimeMonitoringPlan(root);
  const review = await buildExtractionTargetReview(root);
  if (check) {
    if (await readText(reviewPath) !== review) throw new Error("monitoring extraction target review differs from canonical burdens");
    console.log(JSON.stringify({ status: "clean", targets: monitoring.targets.length, tracked_artifacts: 1 }));
    return;
  }
  await writeTextAtomic(reviewPath, review);
  console.log(JSON.stringify({ status: "generated", targets: monitoring.targets.length, tracked_artifacts: 1 }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
