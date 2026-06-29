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
- UserData型にlineUserId/displayName/pictureUrl追加
- firebase.ts をクライアントサイドのみlazy初期化に変更
- layout.tsx のGoogle Fonts削除（オフライン環境対応）
- next.config.ts にLINE CDN画像ドメイン許可追加
- .env.local.example 作成（LINE_CHANNEL_ID, LINE_CHANNEL_SECRET等）
- ビルド成功確認

## [現在のエラー]
- なし

## [未完了のタスク]
- .env.local に LINE_CHANNEL_ID, LINE_CHANNEL_SECRET, LINE_REDIRECT_URI を設定する（手動作業）
- LINE DevelopersコンソールでコールバックURL登録: /api/auth/line-callback
- 動作確認・テスト
