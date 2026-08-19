# 初期マスタ監視設定

- 対応Issue: #30（親Issue: #19）
- 対象: 正本112制度
- 設定: `config/monitoring.yaml`

## 判定結果

| 監視区分 | 件数 | 内容 |
| --- | ---: | --- |
| `automated` | 1 | 消費税。実装済みe-Gov・国税庁adapterを利用 |
| `manual` | 111 | 公式法令URLは特定済みだが、制度固有の抽出adapter・監視条文は未実装 |
| `out_of_scope` | 0 | 正本制度にはなし |

各制度は有効状態、cadence、監視区分、1件以上の公式source、対象URL、adapter、対象ID、抽出対象を持つ。複数法令にまたがる医療保険料等は複数sourceを個別に保存する。URLは設定ファイルと正本の根拠データだけに置き、プログラムへ巡回URLを直書きしない。

`manual`は監視不能を意味しない。公式URLを人が月次確認できるが、構造変更や誤抽出を安全に検知する制度固有adapterが未実装であることを表す。adapterを追加する際は、対象条文、期待文書、抽出規則、fixture、失敗時の扱いをレビューしてから`automated`へ変更する。

レビュー指定の消費税と自動車税は、[監視抽出対象の設定候補](monitoring-extraction-target-review.md)に公式リンクと実際に監視する文面候補を列挙し、`config/monitoring.yaml`へ反映済みである。他制度の対象条文は公式本文の個別精査後に追加する。

地方税23制度は国法レベルの地方税法を監視対象とする。自治体条例、自治体公式サイト、個別税率、法定外税の個別監視は#20へ分離し、`municipal_scope: issue_20`で識別する。

`npm run monitoring:check`は正本・source設定から監視設定を再構築し、制度追加・削除、source URL、監視区分等の差異を検出する。`npm run validate`は全正本IDとsource IDの参照、重複、必須項目、URL形式を検証する。
