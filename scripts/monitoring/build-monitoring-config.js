import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../validate/schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputPath = join(root, "config/monitoring.yaml");
const GENERATED_AT = "2026-08-19T20:13:25+09:00";

function sourceForUrl(sources, url) {
  return sources.find(({ base_url }) => url.startsWith(base_url));
}

function targetId(base) {
  return base.law_id ?? base.source_url.split("/").filter(Boolean).at(-1);
}

export async function buildMonitoringConfig(repositoryRoot) {
  const registry = await readYaml(join(repositoryRoot, "config/sources.yaml"));
  const burdens = [];
  for (const entry of await readdir(join(repositoryRoot, "data/burdens"), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:json|ya?ml)$/.test(entry.name)) continue;
    const document = await readYaml(join(repositoryRoot, "data/burdens", entry.name));
    burdens.push(...(Array.isArray(document) ? document : [document]));
  }

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

async function run() {
  const check = process.argv.includes("--check");
  const content = `${JSON.stringify(await buildMonitoringConfig(root), null, 2)}\n`;
  if (check) {
    if (await readFile(outputPath, "utf8") !== content) throw new Error("config/monitoring.yaml differs from canonical burdens and sources");
    console.log(JSON.stringify({ status: "clean", targets: JSON.parse(content).targets.length }));
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, outputPath);
  console.log(JSON.stringify({ status: "generated", targets: JSON.parse(content).targets.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
