# if-juku Instagram 自動投稿システム

if塾（https://if-juku.net/）のInstagram運用を自動化するシステムです。
毎日2回（09:00, 20:00）、カルーセル投稿とリール動画を自動生成し、Instagramへ投稿します。

## 機能

- **カルーセル投稿生成**: Gemini AI で背景画像を生成し、HTML/CSS テンプレートでテキストを合成
- **リール動画生成**: Remotion で縦型動画（9:16）を生成
- **自動スケジューリング**: GitHub Actions で毎日2回自動実行
- **Instagram Graph API 連携**: 生成したコンテンツを自動投稿

## ディレクトリ構成

```
if-juku-instagram/
├── assets/
│   ├── raw_photos/      # 元の写真素材（ユーザーが追加）
│   ├── generated/       # 生成された画像・動画の保存先
│   └── templates/       # HTML/CSS デザインテンプレート
├── data/
│   ├── topics.json      # 投稿ネタのデータ
│   └── captions/        # キャプション定義
├── src/
│   ├── lib/             # コアモジュール
│   │   ├── config.ts
│   │   ├── geminiImageGenerator.ts
│   │   ├── htmlComposer.ts
│   │   ├── instagramPoster.ts
│   │   ├── logger.ts
│   │   ├── topicSelector.ts
│   │   └── types.ts
│   ├── remotion/        # Remotion 動画コンポーネント
│   │   ├── index.ts
│   │   ├── Root.tsx
│   │   └── ReelVideo.tsx
│   ├── workflows/       # ワークフロースクリプト
│   │   ├── dailyMorning.ts
│   │   └── dailyEvening.ts
│   ├── generateCarousel.ts
│   └── generateReel.ts
├── .github/
│   └── workflows/
│       ├── daily_post.yml
│       └── test.yml
├── package.json
├── tsconfig.json
└── .env.example
```

## セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/your-username/if-juku-instagram.git
cd if-juku-instagram
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. 環境変数を設定

```bash
cp .env.example .env
```

`.env` ファイルを編集して、以下のAPIキーを設定してください：

```env
# Google Gemini API キー
# 取得先: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key

# Instagram Graph API（オプション）
# 取得先: https://developers.facebook.com/
INSTAGRAM_BUSINESS_ACCOUNT_ID=your_account_id
INSTAGRAM_ACCESS_TOKEN=your_access_token
```

### 4. 写真素材を追加（オプション）

`assets/raw_photos/` フォルダに、背景として使用したい写真を追加できます。
Gemini AI がこれらの写真のスタイルを参考にして新しい画像を生成します。

## 使い方

### カルーセル画像を生成

```bash
npm run generate:carousel
```

特定のトピックを指定する場合：

```bash
npx tsx src/generateCarousel.ts --topic=announcement-001
```

### リール動画を生成

```bash
npm run generate:reel
```

30秒版を生成する場合：

```bash
npx tsx src/generateReel.ts --long
```

### Remotion プレビュー

```bash
npm run remotion:preview
```

### ワークフローを手動実行

```bash
# 朝のワークフロー（カルーセル生成）
npm run daily:morning

# 夜のワークフロー（リール生成）
npm run daily:evening
```

## トピックの追加

`data/topics.json` を編集してトピックを追加できます：

```json
{
  "id": "new-topic-001",
  "category": "お知らせ",
  "title": "新しいお知らせ",
  "slides": [
    {
      "type": "cover",
      "headline": "タイトル",
      "subtext": "サブテキスト"
    },
    {
      "type": "content",
      "headline": "ポイント1",
      "points": ["項目1", "項目2", "項目3"]
    },
    // ... 他のスライド
    {
      "type": "thanks",
      "headline": "ありがとう",
      "cta": "フォローしてね！"
    }
  ],
  "caption": "投稿のキャプション #ハッシュタグ"
}
```

## デザインテンプレートのカスタマイズ

`assets/templates/` 内の HTML/CSS ファイルを編集することで、デザインをカスタマイズできます：

- `carousel-cover.html` - 表紙スライド
- `carousel-content.html` - コンテンツスライド
- `carousel-thanks.html` - サンクススライド

### デザインの特徴

- **太い文字**: 900 ウェイトの Noto Sans JP を使用
- **袋文字（縁取り）**: text-shadow で実装
- **視認性の高い配色**: コントラストを重視
- **スマホ最適化**: 1080x1350（4:5）のアスペクト比

## GitHub Actions での自動実行

### 必要な Secrets

GitHub リポジトリの Settings > Secrets に以下を設定：

- `GEMINI_API_KEY`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `INSTAGRAM_ACCESS_TOKEN`

### スケジュール

- **毎日 09:00 (JST)**: カルーセル投稿
- **毎日 20:00 (JST)**: リール投稿

### 手動実行

GitHub Actions タブから「Daily Instagram Post」ワークフローを手動で実行できます。

## Instagram Graph API について

### 必要なスコープ

- `instagram_basic`
- `instagram_content_publish`
- `pages_read_engagement`

### 注意事項

Instagram Graph API は**公開URL**を必要とします。
ローカルで生成した画像・動画を投稿するには、以下のいずれかの方法で公開URLを取得する必要があります：

1. **Cloudinary** にアップロード
2. **AWS S3** にアップロード
3. **GitHub Pages** で公開
4. その他の CDN/ストレージサービス

本システムでは、画像生成までを自動化しています。
Instagram への投稿は、公開URL化の実装を追加するか、手動でアップロードしてください。

## 技術スタック

- **言語**: TypeScript (Node.js)
- **画像生成AI**: Google Gemini 2.0 Flash
- **画像合成**: Puppeteer (HTML/CSS → 画像)
- **動画生成**: Remotion (React ベース)
- **スケジューリング**: GitHub Actions
- **Instagram投稿**: Instagram Graph API

## ライセンス

MIT License

## サポート

問題が発生した場合は、Issue を作成してください。
