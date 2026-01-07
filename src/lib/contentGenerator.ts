/**
 * コンテンツ生成モジュール
 * Gemini APIとトレンドリサーチを使用して
 * 具体的で役立つコンテンツを生成
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { trendResearcher, TrendInfo, DetailedContent } from './trendResearcher.js';
import { photoMetadataParser, PhotoMetadata, EVENT_INFO, MEMBER_INFO } from './photoMetadata.js';
import type { Topic, Slide, CategoryType } from './types.js';

// コンテンツ生成リクエスト
interface ContentRequest {
  category: CategoryType;
  specificTopic?: string;
  photos?: PhotoMetadata[];
  style?: 'educational' | 'entertaining' | 'viral' | 'informative';
}

// 生成されたコンテンツ
interface GeneratedContent {
  title: string;
  slides: Slide[];
  caption: string;
  imagePrompts: string[];
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
   * カテゴリに応じたコンテンツを生成（トレンドリサーチ付き）
   */
  async generateContent(request: ContentRequest): Promise<GeneratedContent> {
    const { category, photos } = request;

    // 活動報告は実際の写真データを使用
    if (category === 'activity' && photos && photos.length > 0) {
      return this.generateActivityContent(photos);
    }

    // その他のカテゴリはトレンドリサーチベース
    logger.info(`${category}カテゴリのコンテンツを生成中...`);

    try {
      // 1. トレンドリサーチ
      const trend = await trendResearcher.researchTrend(category);
      logger.success(`トレンド取得: ${trend.topic}`);

      // 2. 詳細コンテンツ生成
      const detailedContent = await trendResearcher.generateDetailedContent(category, trend);

      // 3. より具体的な画像プロンプトを生成
      const enhancedImagePrompts = await this.generateSpecificImagePrompts(
        category,
        trend,
        detailedContent
      );

      return {
        title: detailedContent.title,
        slides: detailedContent.slides,
        caption: detailedContent.caption,
        imagePrompts: enhancedImagePrompts,
      };
    } catch (error) {
      logger.warn('トレンドリサーチに失敗、フォールバックコンテンツを生成');
      return this.generateFallbackContent(category);
    }
  }

  /**
   * より具体的な画像プロンプトを生成
   */
  private async generateSpecificImagePrompts(
    category: CategoryType,
    trend: TrendInfo,
    content: DetailedContent
  ): Promise<string[]> {
    const prompt = `以下のコンテンツに最適な画像プロンプトを生成してください。

【コンテンツ情報】
カテゴリ: ${category}
トピック: ${trend.topic}
内容概要: ${trend.description}

【スライド構成】
${content.slides.map((s, i) => `${i + 1}. ${s.headline}: ${s.points?.join(', ') || s.subtext || ''}`).join('\n')}

【重要な要件】
1. 抽象的なグラデーションではなく、具体的なシーンを描写
2. 実際に存在しそうな画面、物体、シーンを指定
3. カテゴリに応じた適切なビジュアル:
   - AI系: 実際のAIツールのUI画面、コードエディタ、チャット画面
   - ビジネス系: 収益画面、作業中のPC、具体的な成果物
   - 教育系: 学習中の子供、教室風景、具体的な教材
   - 開発系: コードエディタ、アプリのUI、開発環境

【出力形式（JSON配列）】
各スライド用の具体的な画像プロンプトを生成:
[
  "表紙用: 具体的なシーン描写（例: MacBook Proの画面にClaude AIのチャットインターフェース、暗い部屋でモニターの青い光が顔を照らしている）",
  "内容1用: 具体的なシーン描写",
  "内容2用: 具体的なシーン描写",
  "内容3用: 具体的なシーン描写"
]

必ずJSON配列形式で出力してください。`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const prompts = JSON.parse(jsonMatch[0]);
        if (Array.isArray(prompts) && prompts.length >= 4) {
          return prompts.slice(0, 4);
        }
      }
    } catch (error) {
      logger.warn('画像プロンプト生成に失敗、デフォルトを使用');
    }

    // フォールバック
    return this.getDefaultImagePrompts(category, trend);
  }

  /**
   * デフォルトの画像プロンプト
   */
  private getDefaultImagePrompts(category: CategoryType, trend: TrendInfo): string[] {
    const defaults: Record<CategoryType, string[]> = {
      ai: [
        `A MacBook Pro screen showing ${trend.topic} interface, dark room with blue monitor glow, modern desk setup with RGB keyboard`,
        `Code editor with Python/JavaScript code visible, AI autocomplete suggestions highlighted, dark theme`,
        `Split screen showing AI chat on left and generated output on right, professional developer workspace`,
        `Multiple browser tabs with AI tools open, productivity setup, minimalist desk with plant`
      ],
      business: [
        `Smartphone showing revenue dashboard with upward graph, gold coins scattered on wooden desk, natural lighting`,
        `Laptop screen with ${trend.topic} workspace open, coffee cup beside, cozy home office setting`,
        `Step-by-step workflow diagram on screen, sticky notes around monitor, productive workspace`,
        `Celebration scene with confetti graphics, success metrics on screen, motivational setup`
      ],
      education: [
        `Child learning to code on colorful laptop, bright classroom with educational posters, engaged expression`,
        `Parent and child looking at tablet together, learning app visible, warm home environment`,
        `Modern classroom with students at computers, teacher helping, collaborative learning`,
        `Child proudly showing completed project on screen, accomplishment moment, bright lighting`
      ],
      development: [
        `VS Code or Cursor IDE with app code, multiple monitors showing development progress, professional dev setup`,
        `Mobile app mockup on phone screen, Figma design on monitor behind, design-dev workflow`,
        `Terminal with deployment logs, successful build message, developer celebrating`,
        `App store page showing published app, download metrics visible, achievement moment`
      ],
      activity: [
        `Team of students at computers in modern classroom, collaborative work, engaged expressions`,
        `Gaming setup with esports competition, team wearing matching shirts, competitive atmosphere`,
        `Presentation stage with student showing project, audience engaged, professional event`,
        `Group photo with certificates/trophies, celebration moment, team success`
      ],
      announcement: [
        `Event poster design on digital screen, modern classroom setting, welcoming atmosphere`,
        `Workshop setup with prepared materials, empty seats waiting, anticipation`,
        `Registration desk with signup sheet, friendly staff, professional event setup`,
        `Calendar showing event date highlighted, reminder notification on phone, organized planning`
      ]
    };

    return defaults[category] || defaults.ai;
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
    const peopleList = Array.from(allPeople);

    // メンバー情報を付加
    const peopleWithRoles = peopleList.map(name => {
      const info = MEMBER_INFO[name];
      return info ? `${name}（${info.role}）` : name;
    });

    // 詳細説明を収集
    const descriptions = photos
      .filter(p => p.description)
      .map(p => p.description);

    const prompt = `以下の実際の活動データに基づいて、Instagram投稿用コンテンツを生成してください。

【実際の活動データ】
- イベント名: ${eventInfo?.name || photos[0].event}
- イベント種別: ${eventInfo?.type || 'activity'}
- 参加メンバー: ${peopleWithRoles.join('、')}
- 活動内容: ${descriptions.join('、')}
- イベント説明: ${eventInfo?.description || '活動報告'}

【要件】
- 実際の活動に基づいたリアルな内容
- 参加した人の名前を具体的に出す
- 次回参加したくなるような魅力的な表現
- 5枚構成（表紙→何をした→メンバー紹介→気づき→サンクス）

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "slides": [
    {"type": "cover", "headline": "${eventInfo?.name || 'イベント名'}", "subtext": "臨場感のあるサブテキスト"},
    {"type": "content", "headline": "何をした？", "points": ["具体的な活動1", "活動2", "活動3"]},
    {"type": "content", "headline": "参加メンバー", "points": ["${peopleList[0] || 'メンバー'}の活躍", "${peopleList[1] || 'メンバー'}の様子", "チームの雰囲気"]},
    {"type": "content", "headline": "学び・気づき", "points": ["気づき1", "気づき2", "次への意気込み"]},
    {"type": "thanks", "headline": "次回もお楽しみに！", "cta": "見学・体験歓迎"}
  ],
  "caption": "Instagram用キャプション（${eventInfo?.hashtags?.join(' ') || '#if塾'} を含める、絵文字多め）"
}`;

    const content = await this.generateWithGemini(prompt);

    // 活動報告は実際の写真を使うため、画像プロンプトは写真活用指示
    content.imagePrompts = photos.slice(0, 4).map(p =>
      `USE_PHOTO:${p.filepath}:${p.people.join('_')}:${p.expression}`
    );

    return content;
  }

  /**
   * フォールバックコンテンツ生成
   */
  private async generateFallbackContent(category: CategoryType): Promise<GeneratedContent> {
    const prompts: Record<CategoryType, string> = {
      ai: this.getAIFallbackPrompt(),
      business: this.getBusinessFallbackPrompt(),
      education: this.getEducationFallbackPrompt(),
      development: this.getDevelopmentFallbackPrompt(),
      activity: this.getActivityFallbackPrompt(),
      announcement: this.getAnnouncementFallbackPrompt(),
    };

    return this.generateWithGemini(prompts[category]);
  }

  /**
   * Gemini APIでコンテンツを生成
   */
  private async generateWithGemini(prompt: string): Promise<GeneratedContent> {
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

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

  // フォールバックプロンプト群
  private getAIFallbackPrompt(): string {
    return `あなたはAI・テック系インフルエンサーです。
2025年1月現在の最新AIツールについて、具体的で実用的なInstagram投稿を作成してください。

【トピック候補】
- Claude 3.5 Sonnet / Claude Opus 4の活用法
- Cursor AIでコード開発を10倍速に
- Gemini 2.0の画像生成機能
- Perplexity AIで検索が変わる

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "slides": [
    {"type": "cover", "headline": "キャッチーな見出し", "subtext": "サブ"},
    {"type": "content", "headline": "これは何？", "points": ["具体的な説明1", "説明2", "説明3"]},
    {"type": "content", "headline": "使い方", "points": ["手順1", "手順2", "手順3"]},
    {"type": "content", "headline": "プロのコツ", "points": ["コツ1", "コツ2", "コツ3"]},
    {"type": "thanks", "headline": "保存して試してみて", "cta": "フォローで最新情報"}
  ],
  "caption": "キャプション（ハッシュタグ込み）",
  "imagePrompts": [
    "MacBook screen showing Claude AI chat interface with code generation, dark room setup",
    "VS Code with AI autocomplete suggestions highlighted, professional developer workspace",
    "Split screen workflow with AI tool and output, productivity setup",
    "Success metrics dashboard, completed project celebration"
  ]
}`;
  }

  private getBusinessFallbackPrompt(): string {
    return `あなたは副業・ビジネス系インフルエンサーです。
2025年1月現在の最新の稼ぎ方について、具体的で実用的なInstagram投稿を作成してください。

【トピック候補】
- AI画像でLINEスタンプ販売（月1-10万円）
- ChatGPTでKindle出版する方法
- Canva×AIでデザイン素材販売
- プロンプト販売で副収入

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "slides": [
    {"type": "cover", "headline": "〇〇で月△万円", "subtext": "サブ"},
    {"type": "content", "headline": "何を使う？", "points": ["ツール1", "ツール2", "ツール3"]},
    {"type": "content", "headline": "具体的手順", "points": ["ステップ1", "ステップ2", "ステップ3"]},
    {"type": "content", "headline": "成功のコツ", "points": ["コツ1", "コツ2", "コツ3"]},
    {"type": "thanks", "headline": "挑戦してみよう", "cta": "保存して実践"}
  ],
  "caption": "キャプション",
  "imagePrompts": [
    "Revenue dashboard on laptop showing growing income graph, coins on desk",
    "Creative workspace with design tools open, productive environment",
    "Step-by-step guide on screen, organized workflow setup",
    "Success celebration with earnings milestone on phone"
  ]
}`;
  }

  private getEducationFallbackPrompt(): string {
    return `あなたは教育系インフルエンサーです。
保護者向けに、AI時代の子供の教育について具体的なInstagram投稿を作成してください。

【トピック候補】
- AI時代に本当に必要なスキル
- プログラミング教育の始め方
- ゲームを学びに変える方法
- 子供のスマホ/SNSとの付き合い方

【出力形式（JSON）】
{
  "title": "投稿タイトル",
  "slides": [
    {"type": "cover", "headline": "問いかけ形式", "subtext": "サブ"},
    {"type": "content", "headline": "現状の課題", "points": ["事実1", "事実2", "事実3"]},
    {"type": "content", "headline": "if塾の考え", "points": ["視点1", "視点2", "視点3"]},
    {"type": "content", "headline": "今やるべきこと", "points": ["行動1", "行動2", "行動3"]},
    {"type": "thanks", "headline": "ためになったら保存", "cta": "相談も受付中"}
  ],
  "caption": "キャプション",
  "imagePrompts": [
    "Child learning to code on colorful laptop, engaged expression, modern classroom",
    "Parent and child looking at educational content together, warm home setting",
    "Modern classroom with collaborative learning, students at computers",
    "Child proudly showing completed project, accomplishment moment"
  ]
}`;
  }

  private getDevelopmentFallbackPrompt(): string {
    return `学生が開発したアプリの紹介コンテンツを作成してください。

【出力形式（JSON）】
{
  "title": "開発物タイトル",
  "slides": [
    {"type": "cover", "headline": "〇〇が作った△△", "subtext": "が凄すぎる"},
    {"type": "content", "headline": "何を解決？", "points": ["課題1", "課題2", "課題3"]},
    {"type": "content", "headline": "どう動く？", "points": ["機能1", "機能2", "機能3"]},
    {"type": "content", "headline": "作ってみた結果", "points": ["成果1", "成果2", "成果3"]},
    {"type": "thanks", "headline": "君も作ってみよう", "cta": "無料体験受付中"}
  ],
  "caption": "キャプション",
  "imagePrompts": [
    "App interface mockup on smartphone, modern UI design",
    "Code editor showing development progress, professional setup",
    "App demo showing key features, user-friendly design",
    "Published app success, download metrics visible"
  ]
}`;
  }

  private getActivityFallbackPrompt(): string {
    return `プログラミング教室の活動報告を作成してください。

【出力形式（JSON）】
{
  "title": "今週の活動レポート",
  "slides": [
    {"type": "cover", "headline": "今週の授業", "subtext": "みんな頑張りました"},
    {"type": "content", "headline": "今週のテーマ", "points": ["内容1", "内容2", "内容3"]},
    {"type": "content", "headline": "生徒の様子", "points": ["様子1", "様子2", "様子3"]},
    {"type": "content", "headline": "今週の成果", "points": ["成果1", "成果2", "成果3"]},
    {"type": "thanks", "headline": "来週も頑張ろう", "cta": "見学歓迎"}
  ],
  "caption": "キャプション",
  "imagePrompts": [
    "Students at computers in modern classroom, collaborative atmosphere",
    "Learning activity in progress, engaged students",
    "Student presenting project, proud moment",
    "Team photo, success celebration"
  ]
}`;
  }

  private getAnnouncementFallbackPrompt(): string {
    return `プログラミング教室のお知らせを作成してください。

【出力形式（JSON）】
{
  "title": "お知らせタイトル",
  "slides": [
    {"type": "cover", "headline": "告知見出し", "subtext": "サブ"},
    {"type": "content", "headline": "内容", "points": ["詳細1", "詳細2", "詳細3"]},
    {"type": "content", "headline": "メリット", "points": ["メリット1", "メリット2", "メリット3"]},
    {"type": "content", "headline": "詳細情報", "points": ["日時", "場所", "対象"]},
    {"type": "thanks", "headline": "お申込みはお早めに", "cta": "プロフのリンクから"}
  ],
  "caption": "キャプション",
  "imagePrompts": [
    "Event announcement poster, modern design",
    "Workshop preparation, welcoming setup",
    "Benefits infographic, clear communication",
    "Registration information, call to action"
  ]
}`;
  }
}

export const contentGenerator = new ContentGenerator();
