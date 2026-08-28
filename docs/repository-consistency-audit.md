# リポジトリ整合性監査

- 対応Issue: #82
- 監査日: 2026-08-29

`data/`のJSON・YAML・CSVは、永続ファイルとSchemaの対応を`repository-validator`で明示し、未登録ファイルをエラーにする。`config/`の5正本も同じ対応表で管理する。個別ファイルのSchema適合に加え、ID重複、burden・change・event・phase・source・revenue・mapping・monitoring間の参照を検査する。

今回、既存ファイルのSchema不適合、参照切れ、生成物差分は検出されなかった。一方、将来のファイル追加を検証対象へ登録し忘れる余地と、sourceの`monitoring_tax_ids`およびsemantic baselineの`tax_id`が共通参照検査の対象外だった点を検査不足として修正した。

Schemaは永続化境界、実行時projection、配布物、制度群別registry契約に分かれており、用途のないSchemaや参照切れはない。`reports/`と監視レビュー文書は正本から決定的に再生成し、`generate:check`、`architecture:check`、`monitoring:check`で差分を検出する。npm scriptsと2つのworkflowで使うコマンド・パスはcontract testで照合する。

最終確認は次を実行する。

```text
npm test
npm run validate
npm run generate:check
npm run monitoring:check
npm run inventory:check
npm run audit:coverage
```
