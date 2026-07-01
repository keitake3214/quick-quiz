# Migration Status

## [完了済み]
- developブランチ作成・push
- LINEログイン対応（OAuthフロー、プロフィール取得、Cookie保存）
- 全員一般画面化（管理画面は制限時間変更・部屋解散のみ残す）
- ロビーにLINEアイコン表示（オフライン時薄く、準備完了時グリーンリング）
- 準備完了ボタン追加（全員Readyで自動カウントダウン開始）
- Ready? → 3秒カウントダウン → 自動出題フロー
- 出題画面に出題者LINEアイコン表示
- 結果発表・最終結果にLINEアイコン表示
- join時のundefinedフィールドエラー修正
- タイムアップ後2秒で自動結果発表遷移
- 結果発表画面に準備完了ロビー追加（全員Readyで次の問題へ）
- 最後の問題後は最終結果へ自動遷移
- NEXT_PUBLIC_OWNER_LINE_IDによるオーナー判定・右上解散ボタン常設
- 【バグ修正】executing_transition残留 → nextQuestion失敗時にcountdownへフォールバック
- 【バグ修正】showResults複数実行 → runTransactionでexecution→calculatingの中間状態を挟み1回だけ実行
- 【バグ修正】join時にtotalTimeTakenが0リセット → 既存値を引き継ぐよう修正
- 【バグ修正】resultRevealIndexのリセット漏れ → resultPhaseがidleに戻る際に0リセット追加
- 【不要コード削除】countdownInitRef、setMode、setUserNameをreturnから削除
- 【バグ修正】一般ユーザーの「ゲーム終了」ボタン → removeUser(userName)で自分をFirebaseから削除して退出

## [現在のエラー]
- なし（ビルド成功確認済み: 848c3d5）

## [未完了のタスク]
- Vercelに NEXT_PUBLIC_OWNER_LINE_ID を設定する（手動作業）
- 動作確認・テスト
