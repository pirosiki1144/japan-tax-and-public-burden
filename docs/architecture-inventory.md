# 監視基盤アーキテクチャ棚卸し

- 基準日: 2026-08-27
- 対応Issue: #69、#70
- 機械可読な全件表: [`reports/architecture-inventory.json`](../reports/architecture-inventory.json)
- 設計決定: [`ADR 0001`](adr/0001-monitoring-architecture-boundaries.md)

## 分類方法

`npm run architecture:audit`は`git ls-files`の全件を次の責務へ分類する。個々のファイル名、分類、import隣接リストはJSONレポートに保存するため、この文書へ手作業の重複一覧は持たない。

| 責務 | 判定対象 |
| --- | --- |
| `source_of_truth` | 手編集するconfig、Schema、正本data |
| `derived_artifact` | config/data/docs/generated/reportsの再生成可能な投影 |
| `cli` | コマンド引数とファイル出力を持つ実行入口 |
| `application` | pipeline、generate、automationのユースケース調整 |
| `domain` | 正規化、差分、監査、整合性等の純粋規則 |
| `adapter` | HTTP、文書形式、filesystem Schema読込み等の外部境界 |
| `fixture` | オフライン検証用入力、空ディレクトリ保持 |
| `test` | 自動テスト |
| `documentation` | 仕様、ADR、運用説明 |
| `repository_support` | workflow、template、package管理等 |

未分類が1件でも生じるとテストを失敗させる。これは最終的な配置を表すものではなく、移行前の責務を見失わないための分類である。

## 実測対象

レポートは次を機械計測する。

- Git管理ファイル数と責務別件数
- JavaScriptファイル数、相対import辺、循環import
- 112件中110件の`tax_id`がmonitoring、inventory、制度別判断表へ重複し、消費税・自動車税だけが別経路にある状態
- filesystemを直接importするファイルと、`writeFile` + `rename`による原子的書込みの重複実装
- 現状と#71後の制度追加時変更面

件数はリファクタリング中に変わるため、本文へ固定せずJSONを参照する。#75で基準値との差を評価する。

## 維持・統合・削除候補

| 対象 | 判断 | 根拠 | 実施Issue |
| --- | --- | --- | --- |
| `config/sources.yaml` | 維持 | 巡回URLの唯一の正本 | #71 |
| 制度別adapter判断表4件 | 統合候補 | 共通構造で同一生成処理へ入力される | #71 |
| `config/monitoring.yaml` | 派生物として維持または統合 | runtime向け投影だがinventoryと重複 | #71 |
| `config/adapter-inventory.yaml` | 派生物として維持または統合 | coverage向け投影だがmonitoringと重複 | #71 |
| 対応する制度別Schema4件 | 共通化候補 | 共通フィールドを別Schemaで管理 | #74 |
| source/document/semantic adapter | Registryへ統合 | 選択契約を一箇所で検証する | #72 |
| pipeline/generate/automation | applicationとして維持・再配置 | ユースケース単位の独立責務がある | #73 |
| CLIのファイルI/O | 共通adapterへ統合 | 読込み・検証・原子的書込みが重複 | #73 |
| 既存Schema | 永続化境界単位で維持 | 制約を弱めず、共通定義のみ再利用 | #74 |
| `.gitkeep`、薄い委譲、旧経路 | 削除候補 | 利用箇所と互換性を確認後に不要なら削除 | #75 |
| fixtures | 維持 | 外部通信なしで公式形式とfail-closedを検証 | #74/#75 |

## 後続Issueの境界

当初の#69分割は変更不要と判断した。設定の正本化を#71、実行時のPort/Strategyを#72、CLI/I/Oを#73、Schema/testを#74、削除と定量監査を#75に限定する。機能追加や税データ変更は含めない。
