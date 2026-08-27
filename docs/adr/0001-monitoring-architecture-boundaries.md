# ADR 0001: 監視基盤を浅いPorts and Adapters構成へ段階移行する

- 状態: accepted
- 決定日: 2026-08-27
- 対応Issue: #69、#70

## 文脈

#19で監視対象112制度の初期基盤を構築した結果、工程ごとの安全なレビューを優先して設定、Schema、CLI、処理を追加した。現在の検証は正常だが、同じ`tax_id`が制度別判断表、`monitoring.yaml`、`adapter-inventory.yaml`の3層すべてに112件ずつ現れ、取得・変換・意味抽出・実行制御の境界もフォルダ名だけでは判断しにくい。

一方、このリポジトリは小規模なNode.js ES Modulesプロジェクトである。一般的なHexagonal Architectureのディレクトリをすべて作ると、今回問題となった小ファイルと階層をさらに増やす。

実測では、112件のうち110件の`tax_id`が制度別判断表、`monitoring.yaml`、`adapter-inventory.yaml`の3層すべてに現れる。消費税と自動車税は初号実装の別経路にあり、この例外自体も正本境界が不明瞭であることを示す。実測値と全ファイルの分類は[`reports/architecture-inventory.json`](../../reports/architecture-inventory.json)を正本とする。`npm run architecture:audit`で更新し、`npm run architecture:check`でドリフトを検査できる。

## 決定

Ports and Adaptersの依存原則を採用するが、物理構成は次の4境界に限定する。

```text
cli → application → domain
          ↓          ↑
       adapters ── ports（JavaScriptの小さな契約）
```

- `domain`: 外部I/Oと固定パスを知らない状態、正規化、差分、監査規則
- `application`: scan、monitor、validate、generate等のユースケース調整
- `adapters`: HTTP、filesystem、e-Gov、HTML、PDF、CSV、GitHub出力
- `cli`: 引数、composition root呼出し、表示、終了コードだけ

独立した`ports/`フォルダは先に作らない。複数adapterで共有される実際の契約が現れた時だけ、契約をapplication境界に近接配置する。`src/`への一括移動も行わず、#72と#73で責務を移す際に、既存`script/`配下を上記4境界へ浅く再編する。ファイル数が減らない提案は採用しない。

adapter選択にはStrategy + Registryを使い、依存の組立ては単一composition rootへ集約する。制度固有コードを持たない差は設定で表現し、JavaScriptファイルを追加しない。

## 設定の正本

URLの正本は引き続き`config/sources.yaml`とする。制度ごとの監視判断、capability、manual理由、解除条件、再確認方法については、#71で一つのcanonical monitoring manifestを決定する。

`config/monitoring.yaml`と`config/adapter-inventory.yaml`は派生投影とし、手編集しない。両方を残すか統合するかは、既存consumerの必要フィールドを#71で確認して決める。事実値、公式根拠、確認日時、4種類の日付、自治体境界は変更しない。

## 依存ルール

1. domainはapplication、CLI、adapter、Node.js I/O、外部ライブラリをimportしない。
2. applicationは具体的なHTTP、PDF、filesystem、GitHub実装をimportせず、注入された契約を使う。
3. adaptersはdomainの入出力契約を実装してよいが、別adapterの内部実装へ依存しない。
4. CLIとcomposition rootだけが具体adapterを選択する。
5. 設定やfixtureからプログラムへの逆依存を作らない。
6. 循環importを許可しない。

これらは#74で既存`validate.yml`へ検査を追加し、workflow自体は増やさない。

## 移行順

依存関係を明確にするため、#70 → #71 → #72 → #73 → #74 → #75の直列を維持する。

- #71: 正本manifestを決め、重複する派生設定を一方向生成にする
- #72: 最小Port、Strategy Registry、composition rootを導入する
- #73: CLIとapplicationを分離し、共通I/Oを集約する
- #74: 永続化境界のSchemaとunit/contract/integration testを整理する
- #75: 比較期間後に旧経路・不要ファイルを削除し、全体監査する

#71は設定境界、#72は実行時のadapter境界なので統合しない。#73までは既存npm scriptsを維持する。#75まで新規workflowを作成しない。

## 制度追加時の変更面

現状、既存制度を自動監視へ移す場合は`config/sources.yaml`と制度群別adapter判断表を手編集し、`monitoring.yaml`、`adapter-inventory.yaml`、抽出対象レビューを再生成する。新しい抽出方式ではregistryコードとcontract testも必要になる。

目標は、既存Strategyを使う制度では次の2箇所だけを手編集することとする。

1. `config/sources.yaml`の公式取得先
2. canonical monitoring manifestの制度判断

派生物は一括生成する。新Strategyが必要な場合だけ、Strategy実装とcontract testを追加する。

## ファイル整理の判定基準

- 維持: 独立した変更理由、外部境界、永続化契約のいずれかがある
- 統合: 同じ変更で常に編集され、独立利用されず、統合しても依存方向が崩れない
- 削除: 派生物の重複、移行済みの委譲、空フォルダ、同等テストで代替済み

行数だけでは削除しない。旧経路と新経路のcharacterization結果が一致した後にのみ削除する。

## 結果

- 大規模な一括移動を避けながら、後続Issueの判断基準が統一される。
- 移行期間中は旧経路と新経路が一時的に共存する。
- `git ls-files`を使う棚卸し監査はGitリポジトリ内での実行を前提とする。
- 新しい責務を追加した場合は分類規則とレポートも同じPRで更新する必要がある。
