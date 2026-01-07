/**
 * コンテンツ生成モジュール
 * Gemini APIを使用してトレンドに基づいた魅力的なコンテンツを生成
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { photoMetadataParser, PhotoMetadata, EVENT_INFO } from './photoMetadata.js';
import type { Topic, Slide, CategoryType } from './types.js';

// コンテンツ生成リクエスト
interface ContentRequest {
  category: CategoryType;
  specificTopic?: string;  // 特定のトピック（例: "Claude 3.5", "Sora"）
  photos?: PhotoMetadata[];  // 活動報告用の写真
  style?: 'educational' | 'entertaining' | 'viral' | 'informative';
}

// 生成されたコンテンツ
interface GeneratedContent {
  title: string;
  slides: Slide[];
  caption: string;
  imagePrompts: string[];  // 各スライド用の画像生成プロンプト
}

export class ContentGenerator {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const config = getConfig();
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  /**
   * トレンドを考慮したAI/テック系コンテンツを生成
   */
  async generateAIColumnContent(): Promise<GeneratedContent> {
    const prompt = `あなたはYouTubeやTikTokで人気のテック系インフルエンサーです。
以下の条件でInstagram投稿用のコンテンツを生成してください。

【コンテンツ要件】
- 2024-2025年の最新AIトレンドに基づく
- Z世代に刺さる言い回し（「〇〇してる人、まだいる？」「これ知らないとやばい」等）
- 5枚構成（表紙→内容1→内容2→内容3→サンクス）
- 保存したくなる実用的な情報

【最新トレンド候補から1つ選んで深掘り】
- Claude 3.5/Claude Opus 4（Anthropic最新モデル）
- GPT-4o/ChatGPT新機能
- Gemini 2.0の画像生成機能
- Sora（OpenAI動画生成）
- Midjourney v6.1/Ideogram
- Cursor/GitHub Copilot（AI開発ツール）
- NotebookLM（Google AI）
- Perplexity AI（AI検索）
- ローカルLLM（Ollama, LM Studio）
- AI音楽生成（Suno, Udio）

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "topic": "選んだトレンドトピック",
  "slides": [
    {"type": "cover", "headline": "インパクトのある見出し", "subtext": "サブテキスト"},
    {"type": "content", "headline": "これは何？", "points": ["説明1", "説明2", "説明3"]},
    {"type": "content", "headline": "使い方", "points": ["具体的な使い方1", "使い方2", "使い方3"]},
    {"type": "content", "headline": "プロのコツ", "points": ["実践的なコツ1", "コツ2", "注意点"]},
    {"type": "thanks", "headline": "保存して試してみて！", "cta": "アクション誘導"}
  ],
  "caption": "Instagram用キャプション（絵文字・改行・ハッシュタグ込み）",
  "imagePrompts": [
    "表紙用の画像プロンプト（サイバーパンク風、ツールのUIイメージ等）",
    "内容1用の画像プロンプト",
    "内容2用の画像プロンプト",
    "内容3用の画像プロンプト"
  ]
}`;

    return this.generateWithGemini(prompt);
  }

  /**
   * ビジネス/稼ぐ系コンテンツを生成
   */
  async generateBusinessContent(): Promise<GeneratedContent> {
    const prompt = `あなたはZ世代向けの副業・ビジネス系インフルエンサーです。
以下の条件でInstagram投稿用のコンテンツを生成してください。

【コンテンツ要件】
- 学生でも実践可能な具体的な方法
- 「え、それで稼げるの？」と思わせるフック
- 実際の金額や具体例を入れる
- 5枚構成（表紙→手段→手順→成功の秘訣→サンクス）

【最新の稼ぎ方トレンドから1つ選択】
- AI画像生成でLINEスタンプ販売
- ChatGPTでKindle出版
- AIでYouTube台本作成→外注
- Canva×AIでデザイン素材販売
- AI音声でポッドキャスト→スポンサー
- プロンプトエンジニアリング副業
- AIチャットボット開発受託
- AI活用Webライティング
- NFT/デジタルアート販売
- AI写真加工サービス

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "topic": "選んだ稼ぎ方",
  "slides": [
    {"type": "cover", "headline": "〇〇で月△万", "subtext": "インパクトのあるサブ"},
    {"type": "content", "headline": "何を使う？", "points": ["ツール1", "ツール2", "ツール3"]},
    {"type": "content", "headline": "具体的手順", "points": ["ステップ1", "ステップ2", "ステップ3"]},
    {"type": "content", "headline": "成功のコツ", "points": ["マインドセット", "継続のコツ", "差別化ポイント"]},
    {"type": "thanks", "headline": "稼ぐ力は生きる力", "cta": "挑戦を呼びかけ"}
  ],
  "caption": "Instagram用キャプション",
  "imagePrompts": [
    "コイン、グラフ、成長イメージ",
    "ツールのUI、作業風景イメージ",
    "ステップバイステップのイメージ",
    "成功、達成感のイメージ"
  ]
}`;

    return this.generateWithGemini(prompt);
  }

  /**
   * 教育コラムコンテンツを生成
   */
  async generateEducationContent(): Promise<GeneratedContent> {
    const prompt = `あなたは教育系インフルエンサーです。保護者に刺さるコンテンツを作成してください。

【コンテンツ要件】
- 保護者の不安や疑問に答える
- データや研究結果を引用（もっともらしく）
- 「うちの子にも当てはまる」と思わせる
- 5枚構成（問題提起→現状→解決策→今やるべきこと→サンクス）

【教育トレンドトピックから1つ選択】
- AI時代に本当に必要なスキルとは
- プログラミング教育の正しい始め方
- 「考える力」を育てる家庭での習慣
- ゲームを学びに変える方法
- 子供のスマホ/SNSとの付き合い方
- 不登校×オンライン学習の可能性
- 探究学習で伸びる子の特徴
- 2030年に求められる人材像
- 英語×プログラミングの相乗効果
- 学校では教えてくれないお金の教育

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "topic": "選んだ教育トピック",
  "slides": [
    {"type": "cover", "headline": "問いかけ/逆説", "subtext": "興味を引くサブ"},
    {"type": "content", "headline": "現状の課題", "points": ["事実1", "事実2", "事実3"]},
    {"type": "content", "headline": "if塾の考え", "points": ["視点1", "視点2", "視点3"]},
    {"type": "content", "headline": "今やるべきこと", "points": ["行動1", "行動2", "行動3"]},
    {"type": "thanks", "headline": "ためになったら保存！", "cta": "教育相談も受付中"}
  ],
  "caption": "Instagram用キャプション",
  "imagePrompts": [
    "考える子供、未来的な教室イメージ",
    "データ、グラフ、現状を示すイメージ",
    "解決策、明るい未来イメージ",
    "行動、第一歩を踏み出すイメージ"
  ]
}`;

    return this.generateWithGemini(prompt);
  }

  /**
   * 活動報告コンテンツを生成（実際の写真データ使用）
   */
  async generateActivityContent(photos: PhotoMetadata[]): Promise<GeneratedContent> {
    if (photos.length === 0) {
      throw new Error('写真データがありません');
    }

    // イベント情報を取得
    const eventKey = Object.keys(EVENT_INFO).find(key =>
      photos[0].event.includes(key)
    );
    const eventInfo = eventKey ? EVENT_INFO[eventKey] : null;

    // 写っている人物を集計
    const allPeople = new Set<string>();
    photos.forEach(p => p.people.forEach(person => allPeople.add(person)));

    // 詳細説明を収集
    const descriptions = photos
      .filter(p => p.description)
      .map(p => p.description);

    const prompt = `以下の実際の活動データに基づいて、Instagram投稿用コンテンツを生成してください。

【実際の活動データ】
- イベント名: ${eventInfo?.name || photos[0].event}
- イベント種別: ${eventInfo?.type || 'activity'}
- 参加メンバー: ${Array.from(allPeople).join('、')}
- 活動内容: ${descriptions.join('、')}
- イベント説明: ${eventInfo?.description || '活動報告'}

【要件】
- 実際の活動に基づいたリアルな内容
- 参加した人の様子や雰囲気が伝わる
- 次回参加したくなるような魅力的な表現
- 5枚構成（表紙→何をした→様子→気づき→サンクス）

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "slides": [
    {"type": "cover", "headline": "イベント名/活動名", "subtext": "印象的なサブ"},
    {"type": "content", "headline": "今日何をした？", "points": ["活動1", "活動2", "活動3"]},
    {"type": "content", "headline": "メンバーの様子", "points": ["様子1", "様子2", "様子3"]},
    {"type": "content", "headline": "気づき/学び", "points": ["気づき1", "気づき2", "気づき3"]},
    {"type": "thanks", "headline": "次回もお楽しみに！", "cta": "見学・体験歓迎"}
  ],
  "caption": "Instagram用キャプション（${eventInfo?.hashtags?.join(' ') || '#if塾'} を含める）",
  "imagePrompts": ["実際の写真を使用するため不要"]
}`;

    const content = await this.generateWithGemini(prompt);
    // 活動報告は実際の写真を使うため、imagePromptsは空に
    content.imagePrompts = [];
    return content;
  }

  /**
   * Gemini APIでコンテンツを生成
   */
  private async generateWithGemini(prompt: string): Promise<GeneratedContent> {
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

      // JSONを抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSONの抽出に失敗しました');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        title: parsed.title,
        slides: parsed.slides,
        caption: parsed.caption,
        imagePrompts: parsed.imagePrompts || []
      };
    } catch (error) {
      logger.error('コンテンツ生成に失敗しました');
      throw error;
    }
  }

  /**
   * カテゴリに応じたコンテンツを生成
   */
  async generateContent(request: ContentRequest): Promise<GeneratedContent> {
    switch (request.category) {
      case 'ai':
        return this.generateAIColumnContent();
      case 'business':
        return this.generateBusinessContent();
      case 'education':
        return this.generateEducationContent();
      case 'activity':
        if (request.photos && request.photos.length > 0) {
          return this.generateActivityContent(request.photos);
        }
        // 写真がない場合はデフォルトの活動報告
        return this.generateDefaultActivityContent();
      case 'announcement':
        return this.generateAnnouncementContent(request.specificTopic);
      case 'development':
        return this.generateDevelopmentContent();
      default:
        return this.generateAIColumnContent();
    }
  }

  /**
   * デフォルトの活動報告コンテンツ
   */
  private async generateDefaultActivityContent(): Promise<GeneratedContent> {
    const prompt = `プログラミング教室の活動報告用コンテンツを生成してください。
一般的な授業風景や学習の様子を想定してください。

【出力形式（JSON）】
{
  "title": "今週の授業レポート",
  "slides": [
    {"type": "cover", "headline": "今週の授業", "subtext": "みんな頑張りました！"},
    {"type": "content", "headline": "今週のテーマ", "points": ["学習内容1", "学習内容2", "学習内容3"]},
    {"type": "content", "headline": "生徒の様子", "points": ["様子1", "様子2", "様子3"]},
    {"type": "content", "headline": "今週の成果", "points": ["成果1", "成果2", "成果3"]},
    {"type": "thanks", "headline": "来週も頑張ろう！", "cta": "見学・体験歓迎"}
  ],
  "caption": "キャプション",
  "imagePrompts": ["授業風景イメージ", "学習イメージ", "成果発表イメージ", "チームワークイメージ"]
}`;

    return this.generateWithGemini(prompt);
  }

  /**
   * お知らせコンテンツを生成
   */
  private async generateAnnouncementContent(specificTopic?: string): Promise<GeneratedContent> {
    const prompt = `プログラミング教室のお知らせコンテンツを生成してください。
${specificTopic ? `トピック: ${specificTopic}` : '一般的な告知'}

【出力形式（JSON）】
{
  "title": "お知らせタイトル",
  "slides": [
    {"type": "cover", "headline": "インパクトのある見出し", "subtext": "サブテキスト"},
    {"type": "content", "headline": "何が起きる？", "points": ["内容1", "内容2", "内容3"]},
    {"type": "content", "headline": "参加メリット", "points": ["メリット1", "メリット2", "メリット3"]},
    {"type": "content", "headline": "詳細情報", "points": ["日時", "場所", "対象者"]},
    {"type": "thanks", "headline": "お申込みはお早めに！", "cta": "プロフのリンクから"}
  ],
  "caption": "キャプション",
  "imagePrompts": ["告知イメージ", "内容イメージ", "メリットイメージ", "詳細イメージ"]
}`;

    return this.generateWithGemini(prompt);
  }

  /**
   * 開発物紹介コンテンツを生成
   */
  private async generateDevelopmentContent(): Promise<GeneratedContent> {
    const prompt = `学生が開発したアプリ/プロジェクトの紹介コンテンツを生成してください。
YouTube/TikTokで受けそうな「すごい！」「作りたい！」と思わせる内容で。

【最新の開発トレンドから選択】
- AIチャットボット（LINE Bot、Discord Bot）
- AI画像生成アプリ
- 音声認識アプリ
- ゲーム開発（Unity、Scratch）
- Webアプリ（React、Next.js）
- 業務効率化ツール
- SNS自動化ツール

【出力形式（JSON）】
{
  "title": "開発物タイトル",
  "topic": "選んだ開発プロジェクト",
  "slides": [
    {"type": "cover", "headline": "〇〇が作った△△", "subtext": "が凄すぎる"},
    {"type": "content", "headline": "何を解決？", "points": ["課題1", "課題2", "課題3"]},
    {"type": "content", "headline": "どう動く？", "points": ["機能1", "機能2", "機能3"]},
    {"type": "content", "headline": "使った結果", "points": ["結果1", "結果2", "結果3"]},
    {"type": "thanks", "headline": "君も作ってみよう", "cta": "無料体験受付中"}
  ],
  "caption": "キャプション",
  "imagePrompts": ["アプリUIイメージ", "課題解決イメージ", "機能イメージ", "成果イメージ"]
}`;

    return this.generateWithGemini(prompt);
  }
}

export const contentGenerator = new ContentGenerator();
