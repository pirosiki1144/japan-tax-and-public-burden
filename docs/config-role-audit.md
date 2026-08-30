# architecture責務設定と配布設定の役割監査

- 対応Issue: #99
- 監査日: 2026-08-30

## 結論

`config/architecture-responsibilities.json`と`config/distribution.yaml`は統合せず、どちらも独立ファイルとして維持する。前者は静的依存検査の設計上の正本、後者は配布生成の運用設定であり、変更理由、Schema、読取処理、レビュー観点が異なる。両者を統合しても重複は減らず、無関係な変更が同じファイルへ集中する。

## architecture-responsibilities.json

この台帳は全JavaScriptのpathと`cli`、`composition_root`、`application`、`domain`、`adapter`、`test`を1対1で対応付ける。`architecture-inventory.js`が直接読み、未登録・重複・存在しないpath、禁止依存、循環importを検査する。`architecture-responsibilities.schema.json`が台帳自体の形を検証する。

物理フォルダから責務を推論すると、具体実装を束ねるcomposition rootやテストの明示登録を設計判断としてレビューできなくなる。#91で確立したpath非依存検査を維持するため、生成物やpackage.jsonへ統合せず、手編集する設計正本として必要である。

## distribution.yaml

この設定は追跡配布物の`default_as_of`と`output_directory`を保持し、`distribution-config.schema.json`が値を検証する。生成CLIはこの設定を既定値として読み、repository validationも同じ値から`public-burdens.csv`を再生成してbyte一致を検査する。

基準日と保存先は事実データではなく配布運用方針なので、`data/master/canonical.json`へ統合しない。architecture responsibilityとも関係がないため、architecture台帳へ統合しない。従来package scriptsに重複していたinput、output、as-of指定は削除し、配布設定を既定値の単一管理箇所とした。CLIの明示引数は一時出力や過去時点の再現用に引き続き優先される。

## 変更単位

| ファイル | 変更理由 | 主な読取元 | 統合判断 |
| --- | --- | --- | --- |
| `architecture-responsibilities.json` | JavaScriptの追加・移動・責務変更 | architecture inventory、repository validator | 独立維持 |
| `distribution.yaml` | 配布基準日・追跡CSV保存先の変更 | 配布生成CLI、repository validator | 独立維持 |
