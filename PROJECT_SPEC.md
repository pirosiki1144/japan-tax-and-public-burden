# japan-tax-and-public-burden 調査・設計仕様書

- 文書状態: 初期調査・要件整理
- 調査基準日: 2026-08-16
- 最終更新: 2026-08-16T12:20:19+09:00
- 想定リポジトリ: https://github.com/pirosiki1144/japan-tax-and-public-burden
- 目的: Codex CLIでリポジトリを構築する際の入力資料とし、将来のAGENTS.md、データスキーマ、巡回設定、GitHub Actionsへ分割する

## 1. このプロジェクトの趣旨

日本の税金、社会保険料、法令に基づく拠出金・賦課金・負担金等を、人とAIの双方が参照しやすい構造化データとして公開し、制度の新設、改廃、税率・料率変更、対象者変更、適用開始、徴収開始、終了を継続的に追跡する。

制度一覧だけでなく、次の情報を分離して保存する。

1. 税金等そのものの恒久的な基本情報
2. 法律案、法律、政省令、告示、条例、認可等による変更履歴
3. 公布日、施行日、適用開始日、徴収開始日
4. 年度別の税収・保険料収入・拠出金等の徴収実績
5. 財務省が公表する国民負担率との対応関係
6. 参照した一次情報、取得日時、判定根拠

このデータは制度の存在と変更を可視化するためのものであり、個別の納税額計算、税務・法務上の助言、将来の成立・適用の断定を目的としない。

## 2. 現時点で確定した方針

### 2.1 税金等の状態

税金等の主状態は、次の4種類に限定する。

| 状態 | 定義 |
| --- | --- |
| 未適用 | 新設予定または新設済みだが、対象となる取引・所得・期間等への適用がまだ始まっていない |
| 適用中 | 現在適用されており、追跡対象となる未適用の変更がない |
| 適用中（未適用変更あり） | 現行制度が適用中で、将来適用される新設・改定・対象変更・終了等が別に存在する |
| 終了 | 現在適用される区分がなく、将来適用予定の区分もない |

状態は法律案の審議段階そのものではなく、税金等の適用区分から導出する。法律手続の状態は別フィールドで管理する。

構想・報道段階の変更を主状態に反映する場合もあるため、必ず変更情報側に確度と法律手続状態を持たせる。これにより「適用中（未適用変更あり）」が、単なる報道なのか、提出済み法案なのか、公布済み未適用変更なのかを区別する。

### 2.2 日付

次の4項目を別々に設ける。

| 日付 | 意味 |
| --- | --- |
| 公布日 | 法律・政令等が官報等で公布された日 |
| 施行日 | 法令の規定が法的に効力を生じる日 |
| 適用開始日 | 改正内容が、所得・取引・課税期間・対象者等に適用され始める日 |
| 徴収開始日 | 実際の請求、天引き、申告納付、納付受付等が始まる日 |

補助的に、成立日、閣議決定日、法案提出日、委員会付託日、各採決日、終了日もイベントとして保存する。

重要な注意:

- 法律成立時点で、公布日がまだ未確定のことがある。
- 施行日が「公布の日から起算して一定期間内に政令で定める日」とされ、成立・公布時点では確定しないことがある。
- 施行日と適用開始日と徴収開始日は一致するとは限らない。
- 徴収開始日が4月1日であると推測してはならない。必ず根拠資料を保存する。
- 「令和9年度から」「令和9年分所得税から」等は、無理に単一の日付へ変換せず、原文と正規化結果を併記する。

### 2.3 段階適用

同じ税金等に複数の税率、対象区分、地域、年度、経過措置がある場合、適用区分を複数行で持つ。

徴収開始日は重要なキー項目とするが、日付だけでは衝突するため、推奨主キーは次の複合キーとする。

~~~
tax_id + change_id + collection_start_date + phase_sequence
~~~

同じ徴収開始日に複数の対象区分が始まる場合は、対象区分IDも加える。

### 2.4 巡回先URL

エージェントの指示ファイルやプログラムへURLを直書きしない。すべて config/sources.yaml に外出しし、追加・変更・停止はPull Requestでレビューする。

### 2.5 ニュース

ニュースで新設・増減税・料率変更・対象者変更等を検知した場合は、同一案件の重複を確認してGitHub Issueを新規作成または更新する。

法案成立時のIssue処理について、会話上の要望は「削除」である。ただし、削除すると根拠記事、成立までの経過、重複判定履歴が失われる。監査可能性の観点では、成立時に status:enacted を付けてCloseする方式を推奨する。自動削除は設定で明示的に許可されるまで行わない。

### 2.6 e-Gov更新

e-Gov法令検索で、登録済みの関連法令に新しい改正・版が確認された場合は、関連データを更新するPull Requestを作成する。全法令の無関係な更新ごとにPRを作ると過大になるため、次のいずれかに該当する更新を対象とする。

- 既存の税金等に紐づいた法令
- 税、保険料、負担金、賦課金、拠出金等の候補語を含み、新規候補になり得る法令
- 人が config/sources.yaml または監視対象リストで明示した法令

PRは自動マージしない。

## 3. 対象範囲

### 3.1 含める対象

- 国税
- 地方税
- 年金、医療、介護、雇用、労災等の社会保険料
- 法律、政省令、条例等に基づく拠出金、賦課金、負担金、納付金、調整金、保険料
- 法令上の義務が料金へ転嫁され、利用者が実質的に負担する制度
- 指定法人、独立行政法人、基金、業界機関等が徴収する法定負担
- 段階導入が決まっている将来の負担
- 税率・料率、課税標準、対象者、免除、控除、徴収方法、適用地域の変更

### 3.2 境界事例

次は個別判定し、法的義務と実質負担を分けて記録する。

- 法令ではなく業界団体の定款・自主ルールに基づく会費
- 利用者が任意にサービスを選ぶ場合の料金
- 罰金、過料、延滞金
- 手数料、利用料、補償金
- 一度限りの事業者負担
- 国民が直接払わず、事業者の料金へ転嫁される負担

港湾運送事業拠出金のように、政府答弁で「法令に基づくものではない」とされたものもある。除外せず、法的根拠区分を mandatory_by_law、mandatory_by_regulation、mandatory_by_ordinance、contractual_or_private_rule、indirect_pass_through 等で明示する。

### 3.3 網羅性

参議院質問主意書への政府答弁は、「法令で国民に支払いが義務付けられたもの」の範囲が明確でなく、網羅的・正確な回答は困難としている。したがって、本プロジェクトも初期段階で完全網羅を宣言しない。

各レコードに coverage_status を持ち、confirmed、candidate、needs_review、excluded を区別する。

## 4. 税金等と法律手続を分離した状態設計

### 4.1 税金等の主状態

主状態は2.1の4種類だけを使う。

判定の基本:

1. 現在有効な適用区分があるか
2. 将来開始する変更または終了予定があるか
3. 過去の適用区分しかないか

| 現在適用 | 将来変更 | 状態 |
| --- | --- | --- |
| なし | あり | 未適用 |
| あり | なし | 適用中 |
| あり | あり | 適用中（未適用変更あり） |
| なし | なし、過去のみ | 終了 |

### 4.2 法律手続のイベント

単一の段階番号だけで上書きせず、イベント履歴を保存した上で current_stage を補助的に持つ。

標準的な流れ:

1. 構想・検討
2. 閣議決定または議員による提出決定
3. 法律案提出
4. 先議院の委員会への付託
5. 先議院の委員会審査
   - 趣旨説明
   - 質疑
   - 公聴会、参考人質疑、連合審査、小委員会等
   - 討論
   - 採決
6. 先議院の本会議審議・採決
7. 後議院への送付
8. 後議院の委員会への付託
9. 後議院の委員会審査・採決
10. 後議院の本会議審議・採決
11. 法律成立
12. 公布
13. 施行
14. 適用開始
15. 徴収開始

元の案にあった「登録」は、国会の標準的説明では「討論」と考えられるため、本仕様では趣旨説明、質疑、討論、採決とする。

### 4.3 例外・分岐

次を表現できるようにする。

- 修正議決と他院への回付
- 返付
- 両院協議会
- 衆議院の再議決
- 否決
- 撤回
- 審査未了
- 継続審査、閉会中審査
- 委員会審査省略
- 議員立法、委員会提出法案
- 政令、省令、告示、自治体条例、規則、認可のみで行われる変更
- 法律公布後に施行期日政令で日付が確定する変更

税金等の変更が常に国会審議を通るとは限らない。自治体条例、政省令、告示、所管機関の認可、料金決定、審議会答申等のルートも、同じ change レコードと event レコードで扱う。

## 5. 日付のデータ設計

各日付は値だけでなく、原文、精度、根拠を持つ。

推奨フィールド:

~~~
date_value: 2028-04-01
date_raw: 令和10年度から
date_precision: fiscal_year
date_certainty: enacted
date_source_url: https://example.go.jp/...
verified_at: 2026-08-16T12:20:19+09:00
~~~

date_precision の例:

- exact_date
- month
- calendar_year
- fiscal_year
- tax_year
- relative
- condition_based
- unknown

date_certainty の例:

- news_report
- party_decision
- council_material
- bill_text
- enacted
- promulgated
- enforcement_order
- collector_notice
- observed_collection

適用開始日には対象期間も記録する。

例:

- 2027年1月1日以後に支払う給与
- 2027年分所得税
- 2027年4月1日以後に開始する事業年度
- 2027年度分の個人住民税

## 6. 推奨データモデル

### 6.1 税金等マスター

ファイル例: data/burdens/income-tax.yaml

最低限の項目:

| 項目 | 内容 |
| --- | --- |
| tax_id | 永続的なASCII識別子。名称変更しても変えない |
| official_name | 現在の正式名称 |
| aliases | 略称、旧称、一般的名称 |
| burden_type | 国税、地方税、社会保険料、賦課金、拠出金、負担金等 |
| legal_mandate_type | 法律、政省令、条例、民間ルール、間接転嫁等 |
| jurisdiction | 国、都道府県、市区町村、全国共通等 |
| liable_party | 法律上の納付義務者 |
| economic_bearer | 実質的に負担する者。断定できない場合はunknown |
| collector | 徴収主体 |
| beneficiary_or_fund | 帰属先、基金、会計 |
| purpose | 制度目的 |
| calculation_basis | 課税標準、算定基礎 |
| current_status | 4種類の主状態 |
| legal_bases | 法令ID、法令名、条項、e-Gov URL |
| current_phases | 現在適用中の区分への参照 |
| pending_changes | 未適用変更への参照 |
| source_refs | 根拠資料 |
| verified_at | 最終確認日時 |

### 6.2 変更情報

ファイル例: data/changes/2026-income-tax-basic-deduction.yaml

| 項目 | 内容 |
| --- | --- |
| change_id | 変更の永続ID |
| tax_ids | 影響を受ける税金等。複数可 |
| title | 変更の短い名称 |
| change_types | 新設、税率、対象者、控除、徴収方法、終了等 |
| proposal_origin | 政党、府省、内閣、議員、自治体等 |
| current_stage | 現在の法律手続状態 |
| stage_confidence | confirmed、probable、reported |
| bill_ids | 国会回次、閣法・衆法・参法等の番号 |
| law_ids | 成立後の法律番号、e-Gov法令ID |
| events | 全イベントへの参照 |
| promulgation_date | 公布日 |
| enforcement_date | 施行日 |
| application_start_dates | 適用開始日。複数可 |
| collection_start_dates | 徴収開始日。複数可 |
| source_refs | 法案本文、附則、官報、所管府省資料等 |

### 6.3 適用区分

ファイル例: data/phases/income-tax.yaml

| 項目 | 内容 |
| --- | --- |
| phase_id | 適用区分ID |
| tax_id | 税金等ID |
| change_id | 根拠となる変更ID |
| subject_scope | 対象者・取引・所得・地域 |
| rate_or_amount | 税率、料率、定額等 |
| value | 値の種別、数値、単位、原文、確定区分、対象範囲、根拠不足理由 |
| application_start | 適用開始 |
| application_end | 適用終了 |
| collection_start | 徴収開始 |
| collection_end | 徴収終了 |
| transitional_rule | 経過措置 |
| source_refs | 条文・公表資料 |
| evidence_gaps | 根拠不足や追加確認が必要な事項 |
| verified_at | 最終確認日時 |

### 6.4 法律手続イベント

上書きではなく追記型とする。

~~~
event_id
change_id
event_type
event_date
chamber
committee
subcommittee
meeting_name
result
source_url
source_published_at
observed_at
evidence_excerpt_or_summary
confidence
~~~

event_type の例:

- concept_reported
- council_deliberation
- cabinet_decision
- bill_submitted
- committee_referred
- committee_explanation
- committee_question
- subcommittee_meeting
- committee_debate
- committee_vote
- plenary_vote
- sent_to_other_house
- returned_with_amendment
- conference_committee
- enacted
- promulgated
- enforcement_date_fixed
- enforced
- application_started
- collection_started
- rejected
- withdrawn
- session_expired
- continued

### 6.5 税収・徴収実績

税以外も含むため、データ名は revenue より collected_amount を優先する。

ファイル例: data/revenue/actuals.csv

推奨列:

~~~
record_id
tax_id
fiscal_year
period_start
period_end
amount_yen
amount_raw
amount_kind
accounting_basis
government_level
collector
account_or_fund
gross_or_net
refund_treatment
consolidation_scope
value_status
source_url
source_page_or_table
published_at
verified_at
notes
~~~

amount_kind の例:

- tax_revenue
- insurance_premium_revenue
- contribution_collected
- levy_collected
- charge_collected
- estimated_economic_burden

accounting_basis の例:

- settlement
- provisional_settlement
- revised_budget
- initial_budget
- forecast
- estimate

value_status の例:

- available
- zero
- not_yet_collected
- not_yet_compiled
- government_does_not_track
- unavailable
- included_in_parent_total
- partial

「税収」と「保険料収入」等を同じ意味で扱わない。比較時に二重計上を避けるため、連結範囲、内数、事業主負担・被保険者負担、国・地方間移転も記録する。

### 6.6 情報源レジストリ

config/sources.yaml の推奨項目:

~~~
source_id
name
authority
base_url
entry_urls
source_type
scope
jurisdiction
priority
cadence
enabled
adapter
rate_limit
terms_url
last_verified_at
notes
~~~

source_type の例:

- law_api
- official_gazette
- bill_index
- parliamentary_schedule
- parliamentary_minutes
- cabinet
- ministry
- council
- statistics
- party
- news
- municipal_gazette

## 7. 参議院質問主意書から必ず含める39項目

出典:

- [質問主意書の明細](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/meisai/m212073.htm)
- [質問本文](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/syuh/s212073.htm)
- [政府答弁書](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/touh/t212073.htm)

質問第73号は2023年11月30日に提出され、答弁書は2023年12月12日付である。

1. 子ども・子育て拠出金
2. 預金保険料
3. 生命保険契約者保護機構、損害保険契約者保護機構における保険契約者保護資金に対する負担金
4. 損害保険料率算出機構に対する負担金
5. 日本投資者保護基金に対する負担金
6. 指定紛争解決機関（金融ADR）に対する負担金
7. 株式会社地域経済活性化支援機構法に基づく拠出金
8. 株式会社東日本大震災事業者再生支援機構法に基づく拠出金
9. 再生可能エネルギー発電促進賦課金
10. 廃炉円滑化負担金
11. 電気事業法施行規則に基づく賠償負担金
12. 再処理等拠出金
13. 原子力発電における使用済燃料の再処理等の実施及び廃炉の推進に関する法律に基づく廃炉拠出金
14. 高レベル放射性廃棄物の地層処分に係る拠出金
15. TRU廃棄物の地層処分に係る拠出金
16. 原子力損害賠償・廃炉等支援機構法に基づく一般負担金
17. 原子力損害賠償・廃炉等支援機構法に基づく特別負担金
18. 化石燃料賦課金
19. 脱炭素成長型経済構造への円滑な移行の推進に関する法律に基づく特定事業者負担金
20. 輸入糖に課される調整金
21. 石綿健康被害救済一般拠出金
22. 石綿健康被害救済特別拠出金
23. 汚染負荷量賦課金
24. 公害健康被害の補償等に関する法律に基づく特定賦課金
25. ユニバーサルサービス料
26. 郵便局ネットワークの維持の支援のための拠出金
27. 鉄道バリアフリー料金制度
28. 港湾運送事業拠出金
29. 港湾環境整備負担金
30. 東京タクシーセンター等に納付する事業者負担金
31. 私的録音録画補償金
32. 授業目的公衆送信補償金
33. 図書館等公衆送信補償金
34. 年金保険料
35. 医療保険料
36. 介護保険料
37. 雇用保険料
38. 労災保険料
39. 障害者雇用納付金

名称は質問本文を初期値とし、現行法令での正式名称、通称、旧称を別フィールドで管理する。

## 8. 政府答弁で追加例として示された項目

政府答弁は、次の項目を「現時点で確認できる範囲の例」として挙げている。これも初期候補へ含める。

### 金融庁

- 預金保険機構に対する負担金
- 預金保険機構に対する特定負担金
- 加入者保護信託への負担金
- 銀行等保有株式取得機構に対する拠出金

### 総務省

- 郵便物運送委託補償金
- 聴覚障害者等による電話の利用の円滑化に関する負担金
- ブロードバンドサービスに係る負担金

### 文部科学省

- 原子力損害の補完的な補償に係る一般負担金
- 原子力損害の補完的な補償に係る特別負担金

### 厚生労働省

- 副作用拠出金
- 感染拠出金
- 医薬品等製造販売業者の安全対策等拠出金
- 特定フィブリノゲン製剤又は特定血液凝固第IX因子製剤に係る製造業者等の特定救済拠出金

### 農林水産省

- 農水産業協同組合貯金保険機構に対する保険料
- 農水産業協同組合貯金保険機構に対する負担金
- 農水産業協同組合貯金保険機構に対する特定負担金
- 農林漁業団体職員共済組合に対する特例業務負担金

### 経済産業省

- 鉱害防止事業基金に対する拠出金

### 国土交通省

- 自動車事故対策事業賦課金
- 多目的ダムに係る負担金
- 共同溝の整備等に関する負担金
- 国際基金に対する年次拠出金
- 追加基金に対する年次拠出金
- 電線共同溝の占用予定者の建設負担金
- 電線共同溝の占用予定者であった者以外の者等の占用負担金
- 電線共同溝の整備等に関する管理負担金
- 特定施設を利用して流水をかんがいの用に供する者に係る負担金
- 水資源開発施設又は愛知豊川用水施設を利用して流水を水道、工業用水道の用に供する者等に係る負担金

### 環境省

- 公害防止事業費事業者負担金
- 水俣病が生ずる原因となったメチル水銀を排出した特定事業者に係る補償賦課金

### 農林水産省・経済産業省共管

- 日本商品委託者保護基金に対する負担金

## 9. 政府答弁にある徴収実績の初期シード

政府答弁は原則として令和4年度決算額を回答しているが、未集計項目では過年度値、将来制度では徴収開始予定、政府が把握しない項目では理由を記載している。

代表例:

| 項目 | 期間 | 答弁記載額・状態 |
| --- | --- | --- |
| 年金保険料 | 令和4年度 | 41兆791億4,065万9千円 |
| 医療保険料 | 令和4年度 | 集計未了。参考として令和3年度24兆8,128億8,678万円 |
| 子ども・子育て拠出金 | 令和4年度 | 6,971億5,806万8千円 |
| 雇用保険料 | 令和4年度 | 2兆2,427億6,906万3千円 |
| 労災保険料 | 令和4年度 | 8,908億4,441万8千円 |
| 再生可能エネルギー発電促進賦課金 | 令和4年度 | 2兆5,083億3,002万6千円 |
| ユニバーサルサービス料 | 令和4年度 | 63億1,985万2千円 |
| 郵便局ネットワーク維持支援の拠出金 | 令和4年度 | 2,808億5,696万3千円 |
| 化石燃料賦課金 | 将来 | 令和10年度から徴収開始と答弁 |
| 特定事業者負担金 | 将来 | 令和15年度から徴収開始と答弁 |

これは初期データの根拠にはなるが、現在値ではない。答弁書の全項目を一度取り込み、その後は各所管府省・徴収機関の決算へ更新先を切り替える。

金額が零円である場合と、把握していない場合と、未徴収の場合を同じ0として保存しない。

## 10. 情報源と優先順位

### 10.1 優先順位

1. 官報、公布法令、法令本文、条例、公式決算
2. 衆参両院の議案情報、公報、会議録、採決結果
3. 内閣、所管府省、審議会、徴収機関の公式資料
4. 政党の公式決定・会議資料
5. 報道機関の記事
6. 解説サイト、SNS、二次資料

下位情報源で検知しても、上位情報源が公開されたら根拠を差し替える。複数ソース間で不一致がある場合は上書きせず、差異をIssueまたはPRに明示する。

### 10.2 主要な公式情報源

| 情報源 | URL | 主用途 | 巡回目安 |
| --- | --- | --- | --- |
| e-Gov法令検索 | https://laws.e-gov.go.jp/ | 現行法令本文、法令ID、改正履歴 | 毎日 |
| e-Gov法令API v2 | https://laws.e-gov.go.jp/api/2/swagger-ui | 機械取得 | 毎日 |
| e-Gov法令データ文書 | https://laws.e-gov.go.jp/docs/ | API・XML仕様 | 仕様変更時 |
| e-Govお知らせ | https://laws.e-gov.go.jp/news/ | API・サイト変更 | 毎週 |
| 官報発行サイト | https://www.kanpo.go.jp/ | 法律、政令、省令等の公布確認 | 発行日ごと |
| 内閣法制局 最近の法律・条約 | https://www.clb.go.jp/recent-laws/ | 内閣提出法案、成立、公布 | 毎日 |
| 内閣法制局 法律ができるまで | https://www.clb.go.jp/recent-laws/process/ | 手続定義の基準 | 参照用 |
| 首相官邸 閣議 | https://www.kantei.go.jp/jp/kakugi/ | 閣議決定、法律案、公布、政令 | 閣議日ごと |
| 衆議院 議案情報 | https://www.shugiin.go.jp/Internet/itdb_gian.nsf/html/gian/menu.htm | 法案提出、審議状況、本文、経過 | 毎日 |
| 衆議院 法律案等審査経過概要 | https://www.shugiin.go.jp/internet/itdb_iinkai.nsf/html/gianrireki/ShinsaKeika_m.htm | 付託、委員会・本会議採決等 | 毎日 |
| 参議院 議案情報 | https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm | 法案、付託委員会、審議経過 | 毎日 |
| 参議院公報 | https://www.sangiin.go.jp/japanese/joho1/kousei/koho/current/koho.htm | 本会議・委員会等の日程と経過 | 開会中は毎日 |
| 国会会議録検索 | https://kokkai.ndl.go.jp/ | 本会議、委員会、小委員会等の議事内容 | 毎日または週数回 |
| 国会会議録API仕様 | https://kokkai.ndl.go.jp/api.html | 会議・発言のJSON/XML取得 | 実装時 |
| 財務省 税制改正 | https://www.mof.go.jp/tax_policy/tax_reform/ | 税制改正大綱、法律案資料 | 繁忙期は毎日 |
| 内閣府 税制調査会 | https://www.cao.go.jp/zei-cho/ | 構想・審議会資料 | 会議開催時 |
| 財務省 租税及び印紙収入 | https://www.mof.go.jp/tax_policy/reference/taxes_and_stamp_revenues/index.htm | 国税の月次・年度収入 | 公表時 |
| 財務省 国民負担率 | https://www.mof.go.jp/policy/budget/topics/futanritsu/ | 国民負担率との照合 | 年次 |
| 国税庁 統計情報 | https://www.nta.go.jp/publication/statistics/kokuzeicho/tokei.htm | 税目別・申告等の統計 | 公表時 |
| 総務省 地方税・地方財政 | https://www.soumu.go.jp/main_sosiki/jichi_zeisei/ | 地方税制度・決算 | 公表時 |
| eLTAX | https://www.eltax.lta.go.jp/ | 地方税手続・徴収開始の実務確認 | 変更時 |
| 厚生労働統計一覧 | https://www.mhlw.go.jp/toukei/itiran/ | 社会保険、介護、雇用、労災統計 | 公表時 |
| 日本年金機構 | https://www.nenkin.go.jp/ | 年金保険料・適用・徴収実務 | 変更時 |
| e-Stat | https://www.e-stat.go.jp/ | 政府統計の横断取得 | 公表時 |

e-Gov法令API v2は2025年3月19日に公開された。法令本文・改正履歴の取得に使えるが、法案提出直後や委員会審議の早期検知には向かない。国会情報と組み合わせる。

### 10.3 非国会ルート

次のURL群も config/sources.yaml へ追加できる設計にする。

- 各府省の国会提出法案、審議会、報道発表
- 政党の税制調査会・政策会議
- 都道府県・市区町村の議案、条例、公報
- 独立行政法人、基金、指定法人、徴収機関の決算・料率公表
- パブリックコメント
- 料金認可、告示、所管大臣決定
- 報道機関のRSS・検索ページ

URLの追加はコード変更なしで可能にし、source_id、対象範囲、優先度、巡回頻度、利用条件、無効化フラグをPRで管理する。

## 11. 小委員会の検知

### 11.1 結論

国会の小委員会については一定程度検知できる。ただし、単一のデータ源だけで、開催予定、実際の開催、審議内容、採決をリアルタイムかつ完全に取得できるとは限らない。

推奨する三層確認:

1. 衆参両院の日程・公報で開催予定を早期検知
2. 委員会ニュース、公報、議案経過で開催・議決を確認
3. 国会会議録検索システム/APIで議事内容を確定

国会会議録検索システムは、第1回国会以降の本会議・委員会等を収録し、会議単位・発言単位のAPIを提供している。ただし会議録公開まで時間差があり、過去資料の機械読取テキストには誤字脱字の可能性がある。PDFも照合する。

API利用時は短時間の大量アクセスや多重リクエストを避け、取得後に数秒空け、キャッシュを使用する。

### 11.2 区別すべき「小委員会」

- 国会の委員会内に設置される小委員会
- 政党内の税制調査会、小委員会、部会
- 府省の審議会、分科会、部会、ワーキンググループ
- 自治体議会の委員会・分科会

国会会議録APIで捕捉できるのは主として国会会議録として公開されたもの。政党内・府省内の会議は、それぞれの公式サイトとニュースを別ソースとして巡回する。

### 11.3 別チャットの「法案採択一覧」で取得できているか

この文書作成時点では、別チャットの出力、設定、取得ログ、スキーマを参照できないため、取得できているとは断定できない。

確認条件:

- meeting_name または subcommittee が保存されている
- chamber、committee、開催日、議題、bill_idが保存されている
- 委員会採決と本会議採決が区別されている
- 開催予定と開催実績が区別されている
- source_url と取得日時がある
- 衆参両院の公報と国会会議録APIが巡回対象に含まれる

別チャットの成果物をエクスポートできれば、この条件との突合が必要である。

## 12. ニュースIssueの運用

### 12.1 Issueを作る条件

- 新しい税金等の構想
- 税率・料率の増減
- 課税・徴収対象者の変更
- 控除、非課税、免除、上限・下限の変更
- 適用開始・徴収開始・終了時期の変更
- 法案提出予定、政省令・条例改正予定

単なる論評、既知情報の転載、根拠のないSNS投稿は作成対象にしないか、低確度として人の確認を必要とする。

### 12.2 重複判定

記事タイトルの文字列一致だけで判定しない。次の組合せから topic_key を作る。

~~~
tax_id or candidate_tax_name
change_type
proposal_actor
target_scope
planned_application_period
related_bill_or_policy_id
~~~

同じ topic_key のIssueが開いていれば、新しい記事をコメントまたはsource一覧へ追加する。後続記事で内容が変わった場合は変更点を追記し、過去記述を消さない。

### 12.3 Issueの推奨項目

- 概要
- 対象となる税金等
- 変更種別
- 提案主体
- 現在の確度
- 想定される適用・徴収時期
- 関連法案・法令
- 一次情報
- 報道一覧
- 重複判定キー
- 最終確認日時

推奨ラベル:

- source:news
- stage:concept
- stage:submitted
- stage:enacted
- type:new-burden
- type:rate-change
- type:scope-change
- needs-verification
- duplicate-candidate

### 12.4 終了処理

推奨:

1. 法案成立を公式ソースで確認
2. changeデータへ成立イベントを追加
3. Issueへ成立根拠とPRをリンク
4. status:enactedを付けてClose

削除を採用する場合でも、先にIssueの内容とイベント履歴をデータファイルへ保存し、delete_on_enactment: true が明示された場合だけ削除する。

## 13. e-Gov更新からPRまで

1. e-Govの更新法令一覧またはAPIを定期確認
2. 前回取得した法令ID、改正識別子、本文ハッシュと比較
3. 関連する tax_id と change_id を特定
4. 改正法、被改正法、附則、施行期日を確認
5. 公布日、施行日、適用開始日、徴収開始日を別々に抽出
6. 不明な日付を推測せず unknown または condition_based とする
7. データと取得ログを更新
8. スキーマ検証、リンク検証、状態導出テストを実行
9. 変更根拠、旧値・新値、影響対象を本文に記載したPRを作成
10. 人が確認してマージ

PRに最低限含める内容:

- e-Gov法令ID、法令名、改正法令
- 公布日と更新検知日
- 変更した tax_id、change_id、phase_id
- 4種類の日付の根拠
- 旧状態と新状態
- 自動抽出部分と人の確認が必要な部分

## 14. 税収・徴収実績の更新

### 14.1 原則

- 予算、見通し、速報、実績見込み、決算を混ぜない。
- 年度と暦年を区別する。
- 国税、地方税、社会保険料、事業主負担、被保険者負担を区別する。
- 内数を単純合算しない。
- 収納額、賦課額、負担総額、経済的転嫁額を区別する。
- 公表後の訂正を履歴として残す。

### 14.2 主な更新元

- 国税: 財務省「租税及び印紙収入」、決算、国税庁統計
- 地方税: 総務省「地方財政状況調査」、地方税収入決算、自治体決算
- 社会保険: 厚生労働省統計、特別会計決算、日本年金機構等
- 個別拠出金: 所管府省、徴収機関、基金、独立行政法人等の決算
- 横断確認: e-Stat

月次値と年度決算を別レコードにし、年度決算確定時に月次レコードを消さない。

## 15. 財務省「国民負担率」との一致確認

### 15.1 公式指標

財務省は、租税負担率と社会保障負担率の合計を国民負担率として公表する。分母は国民所得である。実績、実績見込み、見通しが同じ資料に並ぶため、値の状態を必ず保存する。

公式ページ:

- https://www.mof.go.jp/policy/budget/topics/futanritsu/

### 15.2 「一致率」を一つの曖昧な数値にしない

少なくとも次の指標を分ける。

1. 項目カバー率
   財務省の構成項目のうち、本プロジェクトで対応付けできた項目数の割合
2. 金額カバー率
   対応付け済み金額合計 ÷ 財務省公式の負担額
3. 金額差
   対応付け済み金額合計 − 財務省公式の負担額
4. 相対差
   金額差 ÷ 財務省公式の負担額
5. 比率再現差
   プロジェクトの負担額 ÷ 同じ定義の国民所得 − 財務省公表率

### 15.3 対応表

data/reconciliation/national-burden-ratio-mapping.yaml に次を持つ。

~~~
tax_id
fiscal_year
mof_component
mapping_status
included_amount
exclusion_reason
overlap_group
source_url
notes
~~~

mapping_status:

- included
- excluded_by_definition
- overlap
- unallocated
- missing_amount
- pending_review

財務省と同じ分母、年度、確定区分、連結範囲で比較する。公的負担の一覧を単純合算した値が、そのまま国民負担率の分子になるとは限らない。

## 16. 推奨リポジトリ構成

~~~
.
├── README.md
├── PROJECT_SPEC.md
├── AGENTS.md
├── config/
│   └── sources.yaml
├── schemas/
│   ├── burden.schema.json
│   ├── change.schema.json
│   ├── event.schema.json
│   ├── phase.schema.json
│   ├── source.schema.json
│   ├── revenue.schema.json
│   ├── national-burden-ratio.schema.json
│   └── national-burden-ratio-mapping.schema.json
├── data/
│   ├── burdens/
│   ├── changes/
│   ├── events/
│   ├── phases/
│   ├── revenue/
│   │   └── actuals.csv
│   └── reconciliation/
│       ├── national-burden-ratio.csv
│       └── national-burden-ratio-mapping.yaml
├── scripts/
│   ├── fetch/
│   ├── normalize/
│   ├── validate/
│   └── report/
├── reports/
├── tests/
└── .github/
    ├── ISSUE_TEMPLATE/
    ├── pull_request_template.md
    └── workflows/
~~~

README.mdは一般利用者向け、PROJECT_SPEC.mdは設計根拠、AGENTS.mdはエージェントの行動規則に分ける。

`config/sources.yaml` は情報源レジストリ、`data/` 配下の検証済み構造化データは正本とする。取得途中のHTML、PDF、API応答は `.cache/` 配下の一時データとしてGit管理しない。`reports/` と将来の `generated/` は正本から再生成する成果物とし、直接編集しない。履歴は追記型event、phaseとGit履歴で保持する。

### 16.1 Schemaの命名規則

国税・地方税・社会保険料・その他の公的負担を共通で扱う汎用Schemaには、`national` や `local` など管轄を表す接頭辞を付けない。`burden.schema.json`、`change.schema.json`、`revenue.schema.json` のように役割を直接表す名称を用いる。

特定の公式統計・制度・固有概念だけを扱うSchemaでは、その概念を省略しない。`national-burden-ratio.schema.json` の `national-burden-ratio` は管轄ではなく財務省の固有指標「国民負担率」を表すため維持する。同指標への対応表も汎用対応表ではないため、`national-burden-ratio-mapping.schema.json` として対象概念を明示する。

## 17. 品質・検証ルール

### 17.1 必須ルール

- 事実にはsource_urlを付ける。
- observed_atと、情報源上のevent_dateを混同しない。
- 公布日、施行日、適用開始日、徴収開始日を推測で同一にしない。
- 和暦原文を保存し、正規化した西暦値も持つ。
- 法律案名、成立法律名、改正対象法令名を区別する。
- 「成立」「公布」「施行」「適用」「徴収開始」を別イベントにする。
- 税金等の状態と法律手続状態を混同しない。
- ゼロ、未集計、未徴収、非把握、内数を区別する。
- 同じ金額を国・地方・基金間で二重計上しない。
- ニュースだけで確定日付や成立を断定しない。
- 自動生成PRは自動マージしない。

### 17.2 自動検証案

- JSON Schema検証
- IDの一意性
- source_idの参照整合性
- 日付順序の警告
- 適用区分の重複・空白期間の警告
- 「適用中（未適用変更あり）」なのにpending_changesがない場合のエラー
- 「終了」なのに現在または将来の適用区分がある場合のエラー
- 金額の単位・年度・会計基準の必須チェック
- URL到達性チェック
- 同一topic_keyの未解決Issue重複チェック
- 法令本文ハッシュと最終取得版の比較

日付順序は例外があり得るため、単純にエラーにせず警告と根拠要求にする場合がある。

## 18. 公開データと著作権

各情報源の利用規約を config/sources.yaml に保存する。政府サイトのコンテンツには、個別の例外がない限り公共データ利用規約が採用される場合があるが、サイトごとに確認する。

参考:

- [公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)
- [国会会議録検索システムAPI仕様・利用条件](https://kokkai.ndl.go.jp/api.html)

原則:

- 出典名、URL、利用日を記録する。
- 編集・加工したデータであることを明示する。
- ニュース本文や会議録発言を大量転載せず、必要な事実と短い要約、参照URLを保存する。
- ロゴ、写真、第三者著作物等を無断で複製しない。
- リポジトリ自体のライセンスと、参照元データの利用条件を混同しない。
- リポジトリ自体のライセンスは未決定とする。明示的に決定されるまで、特定のライセンスを採用済みとする表記や `LICENSE` ファイルを追加しない。

## 19. Codex CLIとGitHubでの運用案

会話上の最終方針では、pirosiki1144を主アカウントとし、次のリポジトリを使用する。

https://github.com/pirosiki1144/japan-tax-and-public-burden

基本作業:

~~~
git clone git@github.com:pirosiki1144/japan-tax-and-public-burden.git
cd japan-tax-and-public-burden
git switch -c docs/initial-project-spec
codex
git diff --check
git status
git add PROJECT_SPEC.md
git commit -m "docs: add initial tax and public burden project specification"
git push -u origin docs/initial-project-spec
gh pr create --draft
~~~

実際のremote URLと認証方式に合わせて変更する。

pirosiki1144とakane5108を同じ端末で使い分ける場合は、GitHub CLIのログイン切替またはSSH Host Aliasを使用し、作業前に次を確認する。

~~~
gh auth status
git remote -v
git config user.name
git config user.email
~~~

秘密鍵、トークン、Cookie等をリポジトリへ保存しない。公開先を変更する場合は、必ずremoteとPR送信先を確認する。

### 19.1 Issue駆動開発

開発作業はGitHub Issueを起点とする。

1. 着手前に対応するIssueを確認する。
2. Issueが存在しない場合は、目的、対象範囲、受け入れ条件を記載して作成する。
3. ユーザーがIssueを指定して実装を依頼するか、`status:ready` ラベルを付与した時点で、そのIssueの範囲と受け入れ条件の実装を承認したもとする。
4. 実装と検証はIssueの内容を基準に行う。
5. Issueごとの作業ブランチから`main`向けドラフトPRを作成し、関連Issueと受け入れ条件の結果を記載する。
6. CI確認とIssue範囲内の修正まで継続し、人間がレビューとマージ可否の判断を行える状態で停止する。
7. エージェントはPRをマージしない。

`develop`ブランチは設けず、`main`を正本およびデフォルトブランチとする。`main`への直接pushは、対象変更についてユーザーが明示的に指示した場合に限る。

Issueの範囲内にある通常の調査、読み取り、編集、依存関係導入、テスト、検証、作業ブランチの作成、commit、push、Issue・PRの参照と更新、ドラフトPR作成、CI確認、Issue範囲内の修正は、実行ごとの許可確認を不要とする。Issueの参照・更新、作業ブランチへのpush、PR作成など、承認済み開発の通常のGitHub操作は、第三者への実質的な通知とは扱わない。

破壊的操作、権限・secrets・課金・公開範囲の変更、第三者への実質的な通知、Issueの範囲を実質的に広げる変更、推測によるデータ変更、未決定のライセンス表記は停止し、必要な権限と影響を明示する。

エージェントの役割分担は必要最小限とする。通常は主担当が実装と統合を担い、外部一次情報、schema、権限、CIなどの独立検証が必要な高リスクIssueでのみ調査担当や検証担当を追加する。各担当には対象Issue、関連仕様、対象ファイル、直前工程の成果だけを渡す。

## 20. 将来のAGENTS.mdに入れる行動規則

本仕様が合意された後、AGENTS.mdには少なくとも次を定義する。

1. 公式一次情報を優先する。
2. 巡回URLはconfig/sources.yamlだけから読む。
3. 税金等の状態と法律手続状態を分離する。
4. 4種類の日付を個別に扱い、推測しない。
5. 段階適用は複数phaseとして保存する。
6. 変更前に既存tax_id、change_id、Issueの重複を検索する。
7. ニュースはIssue、公式なデータ変更はPRとする。
8. e-Govの関連法令更新を検知したらPRを作る。
9. 金額の確定区分と集計範囲を保存する。
10. 自動マージ・自動削除をしない。
11. 不明点はunknownと根拠不足を記録し、推測で埋めない。
12. 取得失敗や構造変更を黙って無視せずIssue化する。
13. PR本文へ根拠URL、旧値、新値、影響範囲を記載する。
14. スキーマ検証と状態導出テストを通す。
15. NDL API等の利用条件とレート制限を守る。

## 21. 実装順序

### Phase 1: 基盤

- README.mdへ趣旨を記載
- config/sources.yamlを作成
- burden、change、event、phase、sourceのスキーマを作成
- 4状態の導出ロジックとテストを作成

### Phase 2: 初期データ

- 国税・地方税の主要税目を登録
- 参議院質問主意書の39項目を登録
- 政府答弁の追加例を候補登録
- 政府答弁の令和4年度金額を初期シード化

### Phase 3: 国会・法令監視

- 衆議院、参議院、国会会議録APIを取得
- e-Gov法令API v2を取得
- 公布、施行、適用、徴収開始を分離抽出
- 差分PR作成を実装

### Phase 4: ニュース・構想

- ニュースソースを設定
- topic_keyによる重複判定
- Issue作成・更新
- 政党、審議会、自治体ルートを追加

### Phase 5: 実績と照合

- 国税、地方税、社会保険、個別負担の決算取込
- 財務省国民負担率の構成項目マッピング
- カバー率、金額差、比率再現差をレポート

## 22. 決定事項と未決事項

### 22.1 決定事項

1. 成立したニュースIssueは削除せず、公式根拠と変更データへのリンクを追記し、成立済みラベルを付けてCloseする。監査履歴を保持するため、自動削除は行わない。
2. 実装言語は当面Node.jsのJavaScript（ES Modules）とする。TypeScriptへの移行は、データ取得処理の規模と型共有の必要性を踏まえて別のPull Requestで判断する。
3. `.yaml` はYAML 1.2として読み込み、一般的なYAML記法とJSON互換記法の両方を許可する。

### 22.2 未決事項

1. 構想段階の報道だけで主状態を「未適用」「適用中（未適用変更あり）」へ変えるか。変更レコードを作り、確度を表示した上で主状態へ反映する案を推奨するが、一覧表示の設計と併せて決定する。
2. 法令に直接基づかないが実質的に強制される費用をどこまで含めるか。
3. 自治体を全国一括で扱うか、代表自治体から段階導入するか。
5. 税収・徴収実績の開始年度と粒度
6. リポジトリのライセンスは未決定。決定されるまでライセンス表記を行わない。
7. 巡回頻度、GitHub Actionsの実行時間、ニュース取得費用
8. 「国民負担率との一致率」の正式な指標名と許容差

## 23. 調査時点での重要な結論

- 提案された4つの税金等の状態は、簡潔で実用可能である。
- 法律案の段階を同じ状態欄に詰め込まず、法律手続イベントとして分離する必要がある。
- 公布、施行、適用開始、徴収開始は必ず別項目にする。
- 成立時点で全日付が決まるとは限らない。
- 小委員会は公報・日程・議案経過・会議録APIの組合せで検知可能だが、公開の時間差と欠落リスクがある。
- e-Govだけでは提出・委員会・本会議の早期検知はできない。
- 国会外の政省令、告示、条例、認可、審議会、政党ルートを監視対象に含める必要がある。
- ニュース重複は税金等ID、変更種別、提案主体、対象、適用時期、法案IDで判定する。
- 税収以外の金額は「税収」と呼ばず、徴収実績の種類を明記する。
- 財務省国民負担率との比較には、同じ年度、分母、確定区分、連結範囲、重複除外が必要である。
- 参議院質問主意書と答弁書は重要な初期シードだが、政府自身が網羅困難としており、完成一覧ではない。

## 24. 主要参考資料

- [参議院 質問第73号 明細](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/meisai/m212073.htm)
- [参議院 質問第73号 質問本文](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/syuh/s212073.htm)
- [参議院 質問第73号 政府答弁](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/touh/t212073.htm)
- [参議院 法律ができるまで](https://www.sangiin.go.jp/japanese/aramashi/houritu.html)
- [内閣法制局 法律ができるまで](https://www.clb.go.jp/recent-laws/process/)
- [衆議院 議案情報](https://www.shugiin.go.jp/Internet/itdb_gian.nsf/html/gian/menu.htm)
- [参議院 議案情報](https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm)
- [参議院公報](https://www.sangiin.go.jp/japanese/joho1/kousei/koho/current/koho.htm)
- [国会会議録検索システム](https://kokkai.ndl.go.jp/)
- [国会会議録検索API仕様](https://kokkai.ndl.go.jp/api.html)
- [e-Gov法令検索](https://laws.e-gov.go.jp/)
- [e-Gov法令API v2](https://laws.e-gov.go.jp/api/2/swagger-ui)
- [官報発行サイト](https://www.kanpo.go.jp/)
- [財務省 租税及び印紙収入](https://www.mof.go.jp/tax_policy/reference/taxes_and_stamp_revenues/index.htm)
- [財務省 国民負担率](https://www.mof.go.jp/policy/budget/topics/futanritsu/)
- [国税庁 統計情報](https://www.nta.go.jp/publication/statistics/kokuzeicho/tokei.htm)
- [厚生労働統計一覧](https://www.mhlw.go.jp/toukei/itiran/)
- [政府統計の総合窓口 e-Stat](https://www.e-stat.go.jp/)
- [公共データ利用規約（第1.0版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)
