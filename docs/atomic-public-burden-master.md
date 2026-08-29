# 原子負担component正本と単一配布CSV

- 対応Issue: #85（親Issue: #84）
- 契約確定日: 2026-08-30

## 責務と既存形式の対応

| 現行 | 新契約 | 責務 |
| --- | --- | --- |
| `burden` | `public_burdens` | リポジトリ独自の公的負担ID、名称、分類 |
| `burden.legal_bases`、source | `legal_sources` | 項目単位文言、URL、法令日付、任意方向の関係 |
| phaseの値と原文 | `source_facts` | 法令等から直接取得し、表記だけ正規化した値 |
| 暗黙の計算結果 | `calculation_sets` | 入力fact、限定方式、丸め、出力component |
| burdenとphase | `burden_components[].versions` | 加算可能な最小負担単位、当事者、負担開始・終了 |
| current/history/summaryの6配布物 | 単一ワイドCSV | 結合不要の利用者向け投影 |

このIssueでは契約と代表fixtureだけを追加する。現行ID・正本・配布物は変更せず、#86の監視設定統合後、#87で対応表を確認して移行する。

## 正本の規則

`public_burden_id`は制度名や法令名ではなく、このリポジトリが管理する公的負担の識別子である。金額計算で加算する単位は`burden_component`とし、合計率や合計額を別componentとして重複保存しない。

`direct`は、根拠文言の値を意味推論せず表記正規化したものに限る。component値は参照するfactの数値・単位と一致しなければならない。`calculated`は`equal_split`または`explicit_allocation`を参照し、全入力fact、出力component、丸め規則から追跡する。汎用式は実行しない。

法令の成立・公布・施行等は`legal_sources[].dates`、負担の開始・終了はcomponent versionに保存する。同じフィールドを兼用しない。法令間は`parent_source`、`delegated_by`、`references`、`amends`で結び、固定階層を設けない。

実質的負担者は`liable_parties`、法的・事務的な納付義務者は`payment_obligors`へ別々に保存する。

## CSV規則

1行は `component version × calculation basis × liable party` とする。`distribution_row_id`はこれら3つの安定IDを連結して作り、同じ入力と`as_of`から常に同じ行・順序・UTF-8 bytesを生成する。

法令根拠は法令区分別の列にまとめる。同一区分が複数あっても、`legal_source_id`順の引用符付き複数行セルへ格納し、行を増やさない。`as_of`より開始が後なら`future`、終了が前なら`past`、それ以外は`current`とする。確定済みfutureは除外しない。

累進税率は区分ごとのcomponentを加算して税額を求め、率自体は加算しない。消費税は国税分と地方税分など加算可能なcomponentを使い、10%等の合計率行を重複生成しない。厚生年金の例では、18.3%の直接factを`equal_split`し、被保険者9.15%と事業主9.15%を別componentとして扱う。

## 検証

代表fixtureは所得税、消費税、厚生年金を同じSchemaで表す。次のcheckは追跡済みCSVを再生成結果とbyte比較するため、直接編集もCIの既存`generate:check`で検出される。

```text
npm run master-contract:generate
npm run master-contract:check
npm run generate:check
```
