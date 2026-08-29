# 初期マスタ候補のSchema適合性確認

- 対応Issue: #25（親Issue: #19）
- 確認日: 2026-08-18
- 入力: [初期マスタの対象範囲・登録判定ルール](initial-master-scope.md)

## 結論

既存の正本Schemaは、確定した制度、変更、手続イベント、適用区分、出典を分離して表現できる。一方、調査中候補を `burden.schema.json` へ直接入れると、未確認の正式名称や主状態を正本値として埋める必要があった。このため候補専用の `initial-master-candidate.schema.json` を追加し、確定前の調査結果と正本を分離する。

国税・地方税は `burden_type` の `national_tax` / `local_tax` で機械可読に区分する。税以外は同じ一値のenumで社会保険料、拠出金、賦課金等を選ぶため、国税・地方税区分を同時に誤適用できない。管轄中立な共通Schema名は#21の方針を維持する。

## 試験適用結果

| #24の候補・要件 | 適用先 | 判定 | 対応 |
| --- | --- | --- | --- |
| 国税 | `burden_type: national_tax` | 適合 | 既存enumを維持 |
| 地方税 | `burden_type: local_tax` | 適合 | 既存enumを維持 |
| 社会保険料・拠出金・賦課金・負担金等 | `burden_type` | 適合 | 税区分とは排他的な既存enumを維持 |
| 原文名称、未確認の正式名称、調査判定 | 正本burden | 不適合 | 候補専用Schemaに `name_raw`、`official_name`、`coverage_status`、`decision_note` を追加 |
| 状態根拠がない候補 | 正本の必須 `current_status` | 不適合 | 候補Schemaでは `null` を許可し、`evidence_gaps` を必須化。確定候補では4状態を必須化 |
| 複数の徴収主体 | 正本の単一 `collector` 文字列 | 不適合 | 正本・候補とも `collectors` の一意な配列へ変更 |
| 通称・旧称 | `aliases` | 適合 | 一意な配列を維持 |
| 根拠法令 | `legal_bases` | 適合 | 法令名、ID、条項、公式URLを分離済み |
| 公式出典と確認日時 | `source_refs` / `source_urls` / `verified_at` | 適合 | 正本はレジストリ参照、候補は調査元URLを保持 |
| 所管府省と候補段階の根拠法令 | 候補Schema | 不適合 | 実データ調査で必要性を確認し、任意の `responsible_authorities` と `legal_basis_notes` を追加 |
| 公布・施行・適用・徴収開始 | change / phase | 適合 | 4日付を分離し、不明値の根拠不足を検証済み |
| 段階適用、対象範囲、率・金額 | phase | 適合 | 複数phaseと構造化valueを維持 |
| 法律手続の状態 | change / event | 適合 | burdenの主状態と分離済み |
| 複数URL・監視設定 | source | 適合 | `entry_urls`、有効状態、adapter、抽出設定を保持 |
| ID・参照・期間 | repository validator | 適合 | 全ID重複、正本参照、phase期間を検証。候補ID重複も追加 |

## 候補から正本への境界

`data/master/initial-import.json` は公式資料から抽出したレビュー前の調査入力であり、配布用の確定制度マスタではない。候補は次の順で扱う。

1. 公式URL、確認日時、原文名称を候補として保存する。
2. 不明値を推測せず `current_status: null` と `evidence_gaps` で表す。
3. #28で重複、制度粒度、正式名称、状態根拠を確認する。
4. `confirmed` の条件を満たしたものだけ、永続的なIDを付けて `data/master/canonical.json` へ登録する。

候補Schemaの `confirmed` は、`official_name: unknown` と `current_status: null` を拒否する。ただしSchema適合だけで事実確認が完了したとはみなさず、人のレビューと公式根拠確認を必要とする。

## 意図的に今回変更しない事項

- 自治体別の条例、個別税率、法定外税のSchemaは#20で扱う。
- 候補と正本の自動昇格は行わない。
- `jurisdiction` の自治体コード等への構造化は、自治体別データ設計と同時に判断する。
- revenueの `collector` は一つの徴収実績行の徴収主体なので、制度マスタの `collectors` とは別に単数のまま維持する。
