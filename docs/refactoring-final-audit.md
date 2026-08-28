# #69 監視基盤リファクタリング最終監査

- 対応Issue: #75（親Issue: #69）
- 比較基準: #70の棚卸しcommit `1f6c6c6`
- 最終確認日: 2026-08-28

## 結論

#70〜#75の段階移行により、監視判断の重複保存、adapter選択の分散、CLIごとの原子的書込み重複を解消した。112制度の監視分類、正規化結果、公式根拠、manual監査情報、coverage、既存npm scripts、2つのGitHub Actions workflowは維持されている。

`scripts/pipeline/source-adapters.js`は#72でcomposition rootへ移行後、import元がなくなった薄い互換facadeであるため#75で削除した。その他のCLI、application、domain、adapter、Schema、test、fixtureには独立した実行入口、変更理由、永続化・投影契約、またはfail-closed検証の責務があるため維持する。空のGit管理フォルダはない。

## 定量比較

| 指標 | #70時点 | #75完了時 | 判定 |
| --- | ---: | ---: | --- |
| `config/`のGit管理ファイル | 10 | 5 | 5件削減 |
| 手編集する制度群判断ファイル | 4 | 1 | 75%削減 |
| 監視対象を保存する派生設定 | 2 | 0 | 重複保存を解消 |
| 原子的書込み実装 | 12 | 1 | 11件削減 |
| 既存Strategyで制度を自動化する際の手編集箇所 | source + 制度群判断 + 派生物3件 | `sources.yaml` + `monitoring.yaml` | 最大5箇所から2箇所へ削減 |
| GitHub Actions workflow | 2 | 2 | 増加なし |
| 循環import | 0 | 0 | 維持 |
| 禁止依存 | 未検査 | 0 | CI検査を追加 |

Git管理ファイル総数は、Port・Schema・依存規則を検査するcontract testと監査文書を追加したため182件から192件へ増えた。ファイル数だけを減らすために独立責務を混在させず、重複設定数、手編集面、I/O実装数という保守性指標を改善した。最終値は[`reports/architecture-inventory.json`](../reports/architecture-inventory.json)を参照する。

## 維持した境界

- `config/sources.yaml`: 巡回URLの唯一の正本
- `config/monitoring.yaml`: 112制度の監視・実装判断の唯一の正本
- runtime監視計画、実行計画、制度群view: 保存せずメモリ上で決定的に生成
- 制度群Schema: 件数、記事、component、lifecycle等の投影固有制約
- `scripts/application`: I/O非依存のユースケース
- `scripts/adapters`: HTTP、文書、filesystem、Schema検証の具体実装
- `scripts/composition/monitoring-composition.js`: adapter組立ての唯一のcomposition root
- CLI: 引数、application呼出し、表示、終了コード
- fixture: 外部通信なしの形式・構造変更・fail-closed検証専用
- `PROJECT_SPEC.md`: #16で要求移行を照合して削除するため、本Issueでは変更しない

## #69受け入れ条件の監査

| 条件 | 結果 | 根拠 |
| --- | --- | --- |
| 全ファイルの責務分類、維持・統合・削除根拠 | 達成 | architecture inventory、本文の維持境界 |
| 目標構成と依存ルール | 達成 | ADR 0001、architecture check |
| 手編集する監視設定の正本が一意 | 達成 | `config/monitoring.yaml` 1件 |
| 派生設定の決定的生成とCI差分検知 | 達成 | 派生viewはメモリ生成、`monitoring:check`・`monitoring:plan:check` |
| document adapterとsemantic extractorのregistry契約 | 達成 | composition root、strategy contract test |
| CLIとdomain・外部I/Oの分離 | 達成 | application service、filesystem adapter、CLI contract test |
| 制度追加時の変更箇所削減 | 達成 | 既存Strategyなら2正本だけを手編集 |
| 不要ファイル削除と残存責務 | 達成 | 重複設定6件と未使用facadeを削除、本文に維持理由を記録 |
| 循環importなし、禁止依存のCI検査 | 達成 | architecture checkで両方0件を要求 |
| 112制度の結果・分類・coverage一致 | 達成 | monitoring、execution plan、coverage、offline integration test |
| 必須npm検証成功 | 達成 | #75 PRの検証欄に実行結果を記録 |
| workflowを増やさない | 達成 | `validate.yml`、`source-scan.yml`の2件を維持 |

## 残件

本リファクタリングに関する残件はない。制度データの未取得事項は#62、自治体別地方税は#20、`PROJECT_SPEC.md`の要求移行と削除は#16で扱い、#69へ混在させない。
