# 日本の税・公的負担データベース

日本の税金、社会保険料、法令に基づく拠出金・賦課金・負担金などを、根拠資料と変更履歴を伴う構造化データとして公開するプロジェクトです。

初期マスタの調査では、[対象範囲・登録判定ルール](docs/initial-master-scope.md)に従い、公式資料上の候補と正本へ確定登録できる制度を区別します。

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
- `config/monitoring.yaml` は112制度の監視区分、実装状態、capability、手動確認理由・解除条件を一意に管理する唯一の監視設定です。runtime監視計画と実行・coverage計画は、この正本、制度マスタ、source設定からメモリ上で生成し、類似設定ファイルとして保存しません。詳細は[初期マスタ監視設定](docs/monitoring-configuration.md)を参照してください。
- `data/burdens`、`data/changes`、`data/events`、`data/phases`、`data/revenue`、`data/reconciliation` はレビュー後にGitで履歴管理する正本です。`data/monitoring/semantic-baseline.json`は、意味抽出値の前回レビュー済み状態であり、定期監視の項目単位比較に使用します。
- 初期マスタの投入件数と未解決事項は[初期マスタ投入・検証レポート](docs/initial-master-import-report.md)を参照してください。
- `data/candidates` は初期マスタへ昇格する前の調査候補です。Schema検証とGitレビューの対象ですが、確定制度マスタや配布対象として扱いません。適合性と昇格条件は[初期マスタ候補のSchema適合性確認](docs/initial-master-schema-fit.md)、税以外の候補の収集範囲は[税以外の公的負担候補の収集・照合](docs/public-burden-candidate-reconciliation.md)、統合判定は[初期マスタ投入対象の統合判定](docs/initial-master-selection.md)を参照してください。
- 取得途中のHTML、PDF、API応答等は `.cache/` 配下の一時データとし、正本にせずGitにも保存しません。保存が必要な根拠は別Issueで対象と形式をレビューします。
- 公式HTML・PDF・CSVは `scripts/formats/official-document.js` で原文バイトから形式検証・共通表現化し、制度固有の意味抽出規則は別の設定またはnormalize層へ置きます。共通表現は公式URL、取得日時、原文SHA-256、文書版を保持します。PDFの読取不能、CSVの必須列不足、HTMLの本文欠落、意味抽出の0件・複数件一致は構造変更として失敗させます。PR CIは縮小fixtureだけを使用して外部通信せず、実URLへの疎通は固定の定期・手動workflowで行います。
- 社会保険料の集計関係や公的負担の手動確認情報も監視設定の正本に保持し、制度群別viewは必要な処理の中で決定的に組み立てます。
- `reports/` や将来の `generated/` は正本から再生成する成果物であり、直接編集しません。
- 制度の履歴は追記型のeventとphase、およびGit履歴で保持します。既存の事実を上書きして過去の状態を失わないようにします。

## 検証

Node.js 20以降で実行できます。最初に検証用パッケージをインストールしてください。

```bash
npm ci
npm test
npm run validate
npm run monitoring:check
npm run monitoring:plan:check
npm run semantics:check
npm run monitor:check
```

`.yaml` ファイルはYAML 1.2として読み込みます。一般的なYAML記法とJSON互換記法のどちらも使用できます。`npm run validate` はYAML、JSON、CSVを対応するJSON Schemaへ照合し、必須項目、ID重複、参照整合性、URL、日付形式、追加プロパティなどを検証します。

監視設定を変更した場合は`npm run monitoring:generate`で抽出対象レビューを再生成します。`npm run monitoring:check`は正本からruntime監視計画を生成・検証し、レビュー文書の差分も検知します。`npm run monitoring:plan:check`は実行・coverage計画をメモリ上で生成して、未割当や重複を検証します。

## 公式情報の差分検出

`config/sources.yaml` で自動取得を有効化した全sourceを1回のdry-runで実行できます。税目ごとのJavaScriptやworkflowは作らず、共通のHTML抽出adapterに必須marker、値の抽出規則、正本内の照合先を設定します。

```bash
npm run scan -- --all --dry-run --output .cache/source-scan-result.json
```

パイプラインは取得、正規化、検証、正本との意味的差分検出を順に行い、`no_change`、`change_detected`、`error` の機械可読JSONを出力します。取得URL、取得日時、原文バイトのSHA-256も記録します。Phase 2のパイプラインは正本を書き換えず、候補差分はstdoutまたはGit管理外の`.cache/`にだけ出力します。取得失敗や必須構造の欠落時は非0で終了し、部分データは採用しません。

e-Gov法令APIから消費税・自動車税の納税義務者、課税対象、課税標準、税率を意味抽出する検証は次のように実行します。PR CIでは縮小fixtureを使うため外部通信を行いません。実API検証は定期workflowまたは手動実行で行い、結果JSONをartifactに保存します。

```bash
npm run semantics:check
npm run semantics:extract -- --output .cache/semantic-extraction.json
```

#31の共通運用pipelineは、`config/monitoring.yaml`から生成した実行計画で実装済みになった意味抽出adapterと従来のsource差分検出を一括実行します。確定的で正本への対応先がある差分だけを#9のPR候補へ渡し、取得失敗、構造変更、対応先不明、公式source間不一致は#8の重複防止付きIssue候補へ渡します。

```bash
npm run monitor:check
npm run monitor -- --dry-run --output .cache/source-scan-result.json
```

1件の失敗後も他targetを実行し、全結果をartifactへ残します。変更なしの場合はbranch、commit、PR、Issueを作成しません。制度固有の抽出規則は共通pipelineへ書かず、#42〜#46でregistryへadapterを登録します。

意味抽出のbaselineは、実API結果を人間が確認した後だけ更新します。次のコマンドは確認済み結果から候補ファイルを生成するものであり、直接`main`へ反映せずPRで旧値・新値をレビューします。

```bash
npm run semantics:baseline -- --input .cache/source-scan-result.json --output data/monitoring/semantic-baseline.json --confirm-reviewed
```

`.github/workflows/source-scan.yml` は毎週の定期実行と手動実行に対応し、結果JSONをartifactとして保存します。workflow自身や正本データは生成・commitしません。

## コントリビューション

このプロジェクトはIssue駆動で開発します。変更に着手する前に対応するIssueを確認し、Issueがなければ目的、対象範囲、受け入れ条件を記載したIssueを作成してください。Pull Requestには関連Issueを明記し、Issueの受け入れ条件に対する結果を記載します。ユーザーによるPR承認を、実装内容に対する確認として扱います。

あわせて [AGENTS.md](AGENTS.md) と [PROJECT_SPEC.md](PROJECT_SPEC.md) を確認してください。新しい事実には一次情報のURLと確認日時を付け、推測値は登録しないでください。巡回先の追加・変更・停止もPull Requestでレビューします。

定期巡回は既存の `source-scan.yml` だけで実行します。確定的な差分がある場合は固定ブランチ `automation/official-source-updates` から `main` 向けのPRを作成し、既存PRがあれば更新します。取得失敗、構造変更、対象不明、正本との競合ではデータをcommitせず停止します。変更がなければbranch、commit、PRを作成せず、自動マージも行いません。

監査は `npm run audit -- --output .cache/repository-audit.json` で実行できます。制度日付、主状態と法律手続状態、phase期間、参照関係、金額の集計範囲を検査し、再生成可能なJSONレポートを `.cache/` に出力します。定期巡回で一時障害の再試行後も取得できない場合、参照元の構造が変わった場合、公式ソース間で値が一致しない場合、または正本へ対応付けられない場合は、正本を推測更新せず `[audit-topic:...]` を持つIssueを作成します。同じキーの未解決Issueは再利用し、解決後もIssueを削除せず根拠と関連PRを残してCloseします。

## 配布用データの生成

`data/` と `config/` を正本とし、`generated/` のCSV・JSONを一方向に生成します。通常は次のコマンドを使用します。

```bash
npm run generate
npm run generate:check
```

基準日は `config/distribution.yaml` の `default_as_of` です。過去時点を再現する場合は、追跡対象を上書きせず `.cache/` へ出力します。

```bash
npm run generate -- --as-of 2019-10-01 --output-dir .cache/distribution-2019-10-01
```

- `current.json` / `current.csv`: 指定日時点で適用中のphaseと主状態
- `history.json` / `history.csv`: burden、change、event、phase、税収・照合データの履歴
- `summary.json` / `summary.csv`: 件数と、集計条件を分離した金額合計

`included_in_parent_total` は合計から除外し、未集計・未徴収・非把握・部分値は0円と推測せず別一覧に残します。JSONは正本の全項目を保持し、履歴CSVは `payload_json` に元レコードを保持します。同じ正本と基準日からはbyte単位で同一の生成物が得られ、CIの `generate:check` が直接編集や更新漏れを検出します。

`history.json` のSchema version 2では、財務省の固有指標「国民負担率」への対応表を `national_burden_ratio_mappings` と呼びます。version 1の `national_burden_mappings` から名称が変わっているため、利用側は `schema_version` を確認してください。

現在はGitリポジトリ内の成果物として配布します。GitHub PagesやAPI公開は、公開URL、更新保証、キャッシュ、障害対応、費用と権限を決める必要があるため、このIssueには含めず別Issueで判断します。
