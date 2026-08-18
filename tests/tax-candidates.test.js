import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readYaml } from "../scripts/validate/schema-validator.js";

const nationalPath = fileURLToPath(new URL("../data/candidates/national-taxes.yaml", import.meta.url));
const localPath = fileURLToPath(new URL("../data/candidates/local-taxes.yaml", import.meta.url));

const NATIONAL_NAMES = [
  "所得税", "復興特別所得税", "森林環境税", "防衛特別所得税", "法人税", "地方法人税", "特別法人事業税", "防衛特別法人税",
  "消費税", "酒税", "たばこ税", "たばこ特別税", "揮発油税", "地方揮発油税", "石油ガス税", "航空機燃料税", "石油石炭税",
  "電源開発促進税", "自動車重量税", "国際観光旅客税", "関税", "とん税", "特別とん税", "相続税・贈与税", "登録免許税", "印紙税"
];

const LOCAL_NAMES = [
  "住民税", "事業税", "地方消費税", "地方たばこ税", "ゴルフ場利用税", "軽油引取税", "自動車税", "軽自動車税", "鉱区税", "狩猟税", "鉱産税", "入湯税",
  "不動産取得税", "固定資産税", "特別土地保有税", "法定外普通税", "事業所税", "都市計画税", "水利地益税", "共同施設税", "宅地開発税", "国民健康保険税", "法定外目的税"
];

test("all Ministry of Finance national and local tax entries are represented once", async () => {
  const national = await readYaml(nationalPath);
  const local = await readYaml(localPath);

  assert.deepEqual(national.map(({ name_raw }) => name_raw), NATIONAL_NAMES);
  assert.deepEqual(local.map(({ name_raw }) => name_raw), LOCAL_NAMES);
  assert.equal(new Set([...national, ...local].map(({ candidate_id }) => candidate_id)).size, 49);
  assert.ok(national.every(({ burden_type }) => burden_type === "national_tax"));
  assert.ok(local.every(({ burden_type }) => burden_type === "local_tax"));
});

test("every tax candidate retains official sources, verification time, and unresolved status evidence", async () => {
  const candidates = [...await readYaml(nationalPath), ...await readYaml(localPath)];
  for (const candidate of candidates) {
    assert.ok(candidate.source_urls.length >= 2, candidate.candidate_id);
    assert.match(candidate.verified_at, /^2026-08-18T/);
    assert.equal(candidate.current_status, null);
    assert.ok(candidate.evidence_gaps.length > 0, candidate.candidate_id);
    assert.ok(candidate.decision_note.length > 0, candidate.candidate_id);
  }
});

test("national revenue reconciliation records direct, reference, mismatch, and missing cases", async () => {
  const national = await readYaml(nationalPath);
  const notes = new Map(national.map(({ candidate_id, decision_note }) => [candidate_id, decision_note]));

  assert.match(notes.get("income-tax"), /本表/);
  assert.match(notes.get("reconstruction-special-income-tax"), /参考欄/);
  assert.match(notes.get("inheritance-and-gift-tax"), /表記が異なる/);
  assert.match(notes.get("registration-and-license-tax"), /独立行がない/);
});
