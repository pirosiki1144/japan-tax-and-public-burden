# 監視抽出対象の設定候補

- 対応Issue: #30（親Issue: #19）
- 生成日時: 2026-08-19T20:13:25+09:00
- 対象: レビュー指定の消費税と自動車税
- 確認方法: 公式リンクと、`config/monitoring.yaml`へ反映した監視文面候補を照合する。
- 注意: チェック済みは設定への反映済みを表す。事実値を確定したことは意味せず、取得時に公式本文と構造を検証する。

## 消費税 `consumption-tax`

参照先: [egov-laws / 363AC0000000108](https://laws.e-gov.go.jp/api/2/law_data/363AC0000000108)

- [x] 消費税法第1条・第2条：制度目的、課税資産・軽減対象課税資産等の定義
- [x] 消費税法第4条から第6条：課税対象、納税義務者、非課税
- [x] 消費税法第28条・第29条：課税標準、消費税率
- [x] 消費税法別表第1・第1の2：軽減税率対象

参照先: [nta-consumption-tax-rates / 6101.htm](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6101.htm)

- [x] 法令等の確認基準日
- [x] 国内取引・外国貨物の課税対象
- [x] 標準税率・軽減税率と地方消費税の内訳
- [x] 非課税取引の扱い

参照先: [nta-consumption-tax-rates / nta-consumption-tax-rates-page-2](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6102.htm)

- [x] 法令等の確認基準日
- [x] 軽減税率制度の実施日
- [x] 標準税率・軽減税率と地方消費税の内訳
- [x] 軽減税率の対象品目・除外・判定時期

## 自動車税 `automobile-tax`

参照先: [egov-laws / 325AC0000000226](https://laws.e-gov.go.jp/api/2/law_data/325AC0000000226)

- [x] 地方税法第145条：自動車の定義
- [x] 地方税法第146条から第148条：納税義務者、みなし課税、非課税
- [x] 地方税法第154条：車種・用途・排気量等ごとの標準税率
- [x] 地方税法第155条から第158条：賦課期日、納期、月割、徴収方法
