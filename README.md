# 日本の税・公的負担データベース

日本の税金、社会保険料、法令に基づく拠出金・賦課金・負担金などを、根拠資料と変更履歴を伴う構造化データとして公開するプロジェクトです。

制度そのもの、制度変更、法律手続、適用区分、徴収実績を分けて記録します。公布日・施行日・適用開始日・徴収開始日も同一視しません。設計判断の詳細は [PROJECT_SPEC.md](PROJECT_SPEC.md) を参照してください。

> [!IMPORTANT]
> このデータは制度の存在と変更を可視化するためのものです。個別の納税額計算、税務・法務上の助言、将来の成立・適用の断定には利用できません。

## 現在の実装範囲

Phase 1（基盤）として、次を提供しています。

- 巡回先を一元管理する `config/sources.yaml`
- burden、change、event、phase、source のJSON Schema
- 適用区分から4種類の主状態を導出するロジック
- 設定・データの検証スクリプトとテスト
- Issue、Pull Request、GitHub Actionsの初期設定
- 国税庁の公式情報に基づく消費税の最小サンプル

網羅的な初期データの収集と自動巡回は未実装です。現在のサンプルはSchemaと参照整合性を検証するための最小データであり、網羅性を保証しません。

## ディレクトリ

```text
config/       情報源と巡回設定
schemas/      データ形式のJSON Schema
data/         公開する構造化データ
scripts/      検証・取得・正規化・レポート処理
tests/        自動テスト
reports/      生成レポート
```

## データの境界

- `config/sources.yaml` は巡回先と利用条件を管理する情報源レジストリです。
- `data/burdens`、`data/changes`、`data/events`、`data/phases`、`data/revenue`、`data/reconciliation` はレビュー後にGitで履歴管理する正本です。
- 取得途中のHTML、PDF、API応答等は `.cache/` 配下の一時データとし、正本にせずGitにも保存しません。保存が必要な根拠は別Issueで対象と形式をレビューします。
- `reports/` や将来の `generated/` は正本から再生成する成果物であり、直接編集しません。
- 制度の履歴は追記型のeventとphase、およびGit履歴で保持します。既存の事実を上書きして過去の状態を失わないようにします。

## 検証

Node.js 20以降で実行できます。最初に検証用パッケージをインストールしてください。

```bash
npm ci
npm test
npm run validate
```

`.yaml` ファイルはYAML 1.2として読み込みます。一般的なYAML記法とJSON互換記法のどちらも使用できます。`npm run validate` はYAML、JSON、CSVを対応するJSON Schemaへ照合し、必須項目、ID重複、参照整合性、URL、日付形式、追加プロパティなどを検証します。

## 公式情報の差分検出

`config/sources.yaml` で自動取得を有効化した全sourceを1回のdry-runで実行できます。税目ごとのJavaScriptやworkflowは作らず、共通のHTML抽出adapterに必須marker、値の抽出規則、正本内の照合先を設定します。

```bash
npm run scan -- --all --dry-run --output .cache/source-scan-result.json
```

パイプラインは取得、正規化、検証、正本との意味的差分検出を順に行い、`no_change`、`change_detected`、`error` の機械可読JSONを出力します。取得URL、取得日時、原文バイトのSHA-256も記録します。Phase 2のパイプラインは正本を書き換えず、候補差分はstdoutまたはGit管理外の`.cache/`にだけ出力します。取得失敗や必須構造の欠落時は非0で終了し、部分データは採用しません。

`.github/workflows/source-scan.yml` は毎週の定期実行と手動実行に対応し、結果JSONをartifactとして保存します。workflow自身や正本データは生成・commitしません。

## コントリビューション

このプロジェクトはIssue駆動で開発します。変更に着手する前に対応するIssueを確認し、Issueがなければ目的、対象範囲、受け入れ条件を記載したIssueを作成してください。Pull Requestには関連Issueを明記し、Issueの受け入れ条件に対する結果を記載します。ユーザーによるPR承認を、実装内容に対する確認として扱います。

あわせて [AGENTS.md](AGENTS.md) と [PROJECT_SPEC.md](PROJECT_SPEC.md) を確認してください。新しい事実には一次情報のURLと確認日時を付け、推測値は登録しないでください。巡回先の追加・変更・停止もPull Requestでレビューします。
