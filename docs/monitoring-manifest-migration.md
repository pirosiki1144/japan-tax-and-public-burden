# 監視manifest統合と移行対応表

- 対応Issue: #86（親Issue: #84）
- 依存契約: #85
- 移行日: 2026-08-30

## 責務境界

手編集する監視設定は`config/sources.yaml`と`config/monitoring.yaml`の2ファイルだけとする。

| 項目 | 移行前 | 移行後 |
| --- | --- | --- |
| URL、機関、取得接続情報、利用条件 | `sources.yaml`と`monitoring.yaml` | `sources.yaml`のみ |
| HTML・PDF・CSV・spreadsheet adapter台帳 | `format-adapters.yaml` | `monitoring.yaml.adapters.formats` |
| 制度別判断、頻度、manual理由 | `monitoring.yaml.targets` | 同左。target IDと書込候補参照を追加 |
| 許可する計算 | 実装・制度別設定に分散 | `monitoring.yaml.calculation_policies` |
| 実行結果、前回値、未採用差分 | semantic baseline等 | #87で`data/monitoring/review.json`へ物理整理 |
| 配布設定 | `distribution.yaml` | 監視外のため変更なし |

`format-adapters.yaml`と専用Schemaは削除した。形式固有の処理はコードのdocument parser registryへ残し、YAMLにはadapter ID、MIME type、実装状態だけを置く。

## 112 targetの対応

移行前後とも112 targetで、automated 10、manual 102、cadence、municipal scope、implementation状態、manual理由・解除条件・再確認頻度は不変である。`tax_id`は互換投影のため#87まで維持し、同じ値を`public_burden_id`として明示した。

全targetへ`${public_burden_id}-monitoring`形式の`monitoring_target_id`を付けた。既存componentに明示的なfact IDがある9 targetは`canonical_target.source_fact_ids`へ対応し、残る103 targetは#87でfactを投入するまで`canonical_target.legal_state_id`へ対応する。これにより未対応の空参照を許さず、既存IDの統合・分割も行わない。

移行前に`monitoring.yaml`へ存在した53件・40種類のmanual公式URLと、component内の法令日付根拠URLを`sources.yaml`へ移した。既存の自動取得sourceへURLを混在させず、未登録URLは`monitoring_only: true`の独立したmanual sourceとした。結果はsource 58件（うち移行manual source 42件）で、`monitoring.yaml`内のURLは0件である。監視専用sourceは公開配布物へ混入させない。

## directとcalculated

監視targetは公式文書から直接得るfactまたは法令状態だけへ対応する。表記正規化はdirect factの生成範囲とし、自由式、意味推論、暗黙合算を設定へ記述できない。

計算候補は`equal_split`と`explicit_allocation`だけを許可する。入力`source_fact_id`、policy ID、出力component ID、丸めを必須で返す。厚生年金の契約テストではdirect fact 18.3を`equal_split`し、被保険者・事業主の2候補9.15へ変換する。採用値は監視YAMLへ保存しない。

## 追加・レビュー手順

1. 公式URLと取得条件を`sources.yaml`へ1回だけ追加する。
2. `monitoring.yaml.targets`へ1項目位置・1 factまたは法令状態のtargetを追加する。
3. 既存adapterを使えない場合だけコードregistryとcontract testを追加する。
4. `npm run monitoring:generate`で人間向けレビュー文書を更新する。
5. `npm run validate`、`npm run monitoring:check`、`npm run inventory:check`を実行する。
6. 実行結果と未採用差分は設定YAMLへ書き戻さず、#87のreview領域へ保存する。
