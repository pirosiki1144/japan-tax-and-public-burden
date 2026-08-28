# Schema・テスト境界

- 対応Issue: #74（親Issue: #69）

## Schemaの境界

`schemas/common.schema.json`へ共通化するのは、複数の永続化・投影境界で意味と制約が完全に同じ次の定義だけとする。

- kebab-caseの永続ID
- ISO 8601の確認日時
- 重複を許さない1件以上のsource ID配列
- 20文字以上の保留・根拠不足理由

次のSchemaは独立した変更理由とconsumerを持つため統合しない。

| Schema群 | 境界・独立維持の理由 |
| --- | --- |
| `monitoring.schema.json` | 手編集する監視判断の唯一の正本 |
| `monitoring-runtime.schema.json` | source URLと抽出対象を展開したメモリ上のruntime契約 |
| `monitoring-execution-plan.schema.json` | batch、形式、capabilityを展開したメモリ上の実行契約 |
| `national/local/social/public-*-adapters.schema.json` | 正本から生成する制度群view。件数、記事、component、lifecycle等の制度群固有制約を維持 |
| `burden/change/event/phase` | 税金等の主状態、法律手続、出来事、段階適用を分離する正本 |
| `distribution-*` | 公開artifactごとに異なる外部互換契約 |

共通Schema参照後も、件数、必須項目、条件分岐、列挙、日付、追加property禁止は各Schemaに残す。`tests/schema-contracts.test.js`で共通制約と制度群固有制約の双方が不正値を拒否することを検証する。

## テストの責務

ファイル移動によるimport churnを避け、名前と責務で分類する。#75の最終評価でも、次の異なる失敗理由を持つテストは独立責務があるため維持した。

| 分類 | 責務 | 代表例 |
| --- | --- | --- |
| unit | I/Oなしの状態導出、正規化、差分、監査規則 | `derive-status.test.js`、`date-evidence.test.js`、`repository-audit.test.js` |
| contract | Schema、Port、Strategy registry、adapter戻り値、依存方向 | `schema-contracts.test.js`、`strategy-registry.test.js`、`format-adapter-registry.test.js`、`architecture-inventory.test.js` |
| integration | 複数境界をfixtureで接続し、生成物・監視・fail-closedを確認 | `source-pipeline.test.js`、`monitoring-pipeline.test.js`、`distribution-generator.test.js` |
| fixture | 外部通信なしで公式形式と構造変更を再現する入力 | `tests/fixtures/` |

fixtureはテストとPR CI専用である。本番の正本設定は`tests/fixtures`を参照せず、実行時にCLIの明示的な`--fixture-dir`が指定された場合だけ利用する。

## CIで検査する構造規則

既存の`npm run validate`に含まれるarchitecture checkで次を検査し、新しいworkflowは追加しない。

- 循環importを許可しない
- `scripts/application`から`adapters`、`composition`、`fetch`、`formats`、`pipeline`へ依存しない
- `scripts/adapters`から`application`、`composition`、`pipeline`へ逆依存しない
- 構造レポートのドリフトを許可しない
