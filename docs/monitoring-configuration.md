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

## 全制度adapter棚卸し

`config/adapter-inventory.yaml`は正本112制度を重複なく実装先へ割り当てる再生成可能なregistryである。内訳は#39の初号2制度、#42の国税23制度、#43の地方税22制度、#44の社会保険料5制度、#45のその他公的負担60制度となる。消費税・自動車税を含めると国税24制度、地方税23制度を網羅する。

各targetは優先度、依存Issue、batch、共通source再利用キー、自治体範囲、納税義務者・課税対象・算定基礎・率／金額・適用期間の抽出可否を持つ。各公式sourceには`source_id`と`target_id`、形式、現在のadapter、必要な意味抽出adapter、実装状態を記録する。巡回URLは複製せず既存のsource・監視設定から参照する。e-Gov以外の形式は#46の共通形式adapterへも関連付ける。

通常batchは15制度以下とし、20制度を超えるのは同一の共通法令・sourceを再利用する単位だけに限定する。地方税法を共有する地方税22制度がこの例外に該当する。自治体条例と自治体別実税率は引き続き#20で扱う。

```bash
npm run inventory:generate
npm run inventory:check
```

`inventory:check`は`config/monitoring.yaml`から棚卸しを再生成してbyte単位で比較し、未割当、未知target、重複、batch上限違反、地方税の#20分離違反を失敗にする。PR CIでも実行する。

## 後続工程との責務境界

- #30（PR #38）: 監視元、条文selector、改訂ID・更新日時、対象ノードhashによる変更検知の契約を整備する。納税義務者や税率を意味のある値へ変換する処理は含めない。
- #39（#19-8）: 消費税と自動車税について、納税義務者、課税対象、課税標準、税率を構造化抽出する。`npm run semantics:check`は縮小fixtureと期待JSONを比較し、`npm run semantics:extract -- --output .cache/semantic-extraction.json`は実APIのレビュー用JSONを生成する。PR CIは前者、定期／手動workflowは後者を実行する。
- #41: 全制度を#39・#42〜#45へ割り当て、形式別共通処理を#46、最終coverage監査を#47へ分離する。
- #31（#19-9）: #39の正規化結果と#41のregistryを共通pipelineへ接続し、定期監視、PR候補、不確実事項Issueへ連携する。意味抽出規則は再実装しない。

実装順は `#30 → #39 → #41 → #31 → #42〜#46 → #47` とする。
