# 税以外の公的負担候補の収集・照合

## 収集結果

第212回国会の質問主意書「税以外の国民負担に関する質問主意書」に列挙された39項目と、政府答弁で関係行政機関が確認した追加例31項目を、合計70件の調査候補として収集した。

- 質問本文39項目: `data/candidates/public-burdens-question-39.yaml`
- 政府答弁の追加例31項目: `data/candidates/public-burdens-government-additions.yaml`
- 確認日時: 2026-08-18T23:35:17+09:00
- [質問本文](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/syuh/s212073.htm)（2023年11月30日提出）
- [政府答弁本文](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/touh/t212073.htm)（2023年12月12日）
- [質問・答弁の明細ページ](https://www.sangiin.go.jp/japanese/joho1/kousei/syuisyo/212/meisai/m212073.htm)

## 判定の境界

この70件は税以外の公的負担になり得る制度の調査候補であり、確定制度マスタでも完全な一覧でもない。政府答弁は、質問の「国民負担」の範囲が必ずしも明らかではなく、網羅的かつ正確な回答は困難であるとしたうえで、各行政機関が確認できた例を示している。そのため、政府答弁の追加31件も「追加例」として保存する。

候補には、法律・省令による負担だけでなく、定款上の会費、契約関係の料金、料金への転嫁が想定される負担、複数制度をまとめた総称が含まれる。`burden_type` と `legal_mandate_type` で暫定的に区別し、制度粒度や法的性質を確定できないものは `coverage_status: needs_review`、`current_status: null`、`evidence_gaps` で不足根拠を記録した。

正本への昇格時は、候補ごとに現行の公式法令・所管機関資料を再確認し、正式名称、納付義務者、徴収主体、状態、制度の分割・重複を解消する必要がある。質問・答弁時点の説明だけから現在状態を推測しない。
