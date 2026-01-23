/**
 * トレンドリサーチモジュール
 * Gemini APIを使用して最新のトレンド情報を取得し、
 * 具体的で役立つコンテンツを生成する
 * デザインルールに基づいて最新トピックを使用
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { designRules } from './designRules.js';
import type { CategoryType } from './types.js';

// トレンド情報の型定義
export interface TrendInfo {
  topic: string;           // トピック名
  description: string;     // 概要説明
  whyTrending: string;     // なぜトレンドなのか
  keyPoints: string[];     // 重要ポイント
  practicalTips: string[]; // 実践的なアドバイス
  hashtags: string[];      // 関連ハッシュタグ
  imageKeywords: string[]; // 画像生成用キーワード
  sources: string[];       // 情報源
}

// コンテンツ生成用の詳細情報
export interface DetailedContent {
  title: string;
  hook: string;            // 興味を引く導入
  slides: {
    type: 'cover' | 'content' | 'thanks';
    headline: string;
    subtext?: string;
    points?: string[];
    cta?: string;
  }[];
  caption: string;
  imagePrompts: string[];  // 各スライド用の具体的な画像プロンプト
  trend: TrendInfo;
}

export class TrendResearcher {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const config = getConfig();
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    // Gemini 2.0 Flash with Google Search grounding
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });
  }

  /**
   * カテゴリに応じた最新トレンドをリサーチ
   * デザインルールの最新/古いトピック情報を使用
   */
  async researchTrend(category: CategoryType): Promise<TrendInfo> {
    try {
      logger.info(`${category}カテゴリのトレンドをリサーチ中...`);

      // デザインルールを読み込み
      const requirements = await designRules.getTrendResearchRequirements();
      const outdatedTopics = await designRules.getOutdatedTopics();

      // カテゴリに応じたプロンプトを取得
      let prompt: string;
      if (category === 'ai') {
        prompt = await this.getAIResearchPromptWithRules();
      } else if (category === 'business') {
        prompt = await this.getBusinessResearchPromptWithRules();
      } else {
        // その他は同期版を使用
        const syncPrompts: Record<CategoryType, string> = {
          ai: this.getAIResearchPrompt(),
          business: this.getBusinessResearchPrompt(),
          education: this.getEducationResearchPrompt(),
          development: this.getDevelopmentResearchPrompt(),
          activity: this.getActivityResearchPrompt(),
          announcement: this.getAnnouncementResearchPrompt(),
        };
        prompt = syncPrompts[category];
      }

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // JSONを抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('トレンド情報の抽出に失敗');
      }

      const trendInfo = JSON.parse(jsonMatch[0]) as TrendInfo;

      // 古いトピックを使用していないかチェック
      const isOutdated = outdatedTopics.some(old =>
        trendInfo.topic.toLowerCase().includes(old.toLowerCase().split('（')[0])
      );

      if (isOutdated) {
        logger.warn(`古いトピック "${trendInfo.topic}" が検出されました。最新トピックに切り替えます。`);
        return this.getDefaultTrend(category);
      }

      logger.success(`トレンドリサーチ完了: ${trendInfo.topic}`);
      return trendInfo;
    } catch (error) {
      logger.error('トレンドリサーチに失敗、デフォルトトピックを使用');
      return this.getDefaultTrend(category);
    }
  }

  /**
   * トレンド情報から詳細なコンテンツを生成
   */
  async generateDetailedContent(
    category: CategoryType,
    trend: TrendInfo
  ): Promise<DetailedContent> {
    // 文体ルールを取得
    const styleInstructions = await designRules.getContentStyleInstructions();

    const prompt = `あなたは企業の広報担当者です。
以下のトレンド情報に基づいて、Instagram投稿用の詳細コンテンツを生成してください。

【トレンド情報】
トピック: ${trend.topic}
概要: ${trend.description}
なぜトレンド: ${trend.whyTrending}
重要ポイント: ${trend.keyPoints.join(', ')}

${styleInstructions}

【コンテンツ要件】
1. 具体的で実用的な情報を提供する
2. 「保存したい」「シェアしたい」と思わせる価値ある内容
3. 4枚のスライド構成（表紙→内容3枚）
4. 落ち着いた広報向けの文体を使用すること

【重要】画像プロンプトは非常に具体的に：
- 「AIコード」ではなく「Cursorの画面にPythonコードが表示され、AIサジェスションがハイライト」
- 「ビジネス」ではなく「MacBookでKindle出版のダッシュボード画面、売上グラフが上昇中」
- 抽象的なグラデーションではなく、具体的なシーンや物体を描写

【出力形式（JSON）】
{
  "title": "投稿タイトル（絵文字禁止）",
  "hook": "最初の1行で興味を引くフレーズ（絵文字禁止）",
  "slides": [
    {
      "type": "cover",
      "headline": "キャッチーな見出し（15文字以内、絵文字禁止）",
      "subtext": "サブテキスト"
    },
    {
      "type": "content",
      "headline": "見出し",
      "points": ["具体的なポイント1", "具体的なポイント2", "具体的なポイント3"]
    },
    {
      "type": "content",
      "headline": "見出し",
      "points": ["ポイント1", "ポイント2", "ポイント3"]
    },
    {
      "type": "content",
      "headline": "見出し",
      "points": ["ポイント1", "ポイント2", "ポイント3"]
    }
  ],
  "caption": "Instagram用キャプション（絵文字禁止、改行、ハッシュタグ込み300文字程度）",
  "imagePrompts": [
    "表紙用：具体的な画像シーンの描写（例：MacBook Proの画面にClaude AIのチャット画面、暗い部屋でモニターの光が反射）",
    "内容1用：具体的な画像シーンの描写",
    "内容2用：具体的な画像シーンの描写",
    "内容3用：具体的な画像シーンの描写"
  ]
}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('コンテンツの抽出に失敗');
      }

      const content = JSON.parse(jsonMatch[0]);
      return {
        ...content,
        trend,
      };
    } catch (error) {
      logger.error('詳細コンテンツ生成に失敗');
      throw error;
    }
  }

  /**
   * AI/テック系のリサーチプロンプト
   * デザインルールから最新トピックを取得
   */
  private async getAIResearchPromptWithRules(): Promise<string> {
    const currentTopics = await designRules.getCurrentAITopics();
    const outdatedTopics = await designRules.getOutdatedTopics();

    return `あなたはAI・テクノロジーの最新動向に詳しいリサーチャーです。
2025年後半〜2026年1月現在の最新AIトレンドをリサーチしてください。

【最新トピック一覧（必ずこれらから選択）】
${currentTopics.map(t => `- ${t}`).join('\n')}

【使用禁止（古い情報）】
${outdatedTopics.map(t => `- ${t}`).join('\n')}

【調査対象】
- 最新のAIモデル（Claude Opus 4.5, GPT-5, Gemini 2.0等）
- AI開発ツール（Cursor AI, Windsurf, v0, Bolt等）
- 話題のAIサービス（Perplexity, NotebookLM等）
- 生成AI（動画: Sora, 画像: Midjourney v6.1等）
- YouTube/TikTokで話題のAI活用法

【重要】以下の点を必ず含めてください：
- 具体的な使い方やテクニック
- 実際に試せる無料の方法
- 知らないと損する新機能
- 2026年1月現在の最新情報のみ使用

【出力形式（JSON）】
{
  "topic": "具体的なトピック名（最新トピック一覧から選択）",
  "description": "このトピックの概要説明（100文字程度）",
  "whyTrending": "なぜ今話題なのか（50文字程度）",
  "keyPoints": [
    "重要ポイント1（具体的に）",
    "重要ポイント2（具体的に）",
    "重要ポイント3（具体的に）"
  ],
  "practicalTips": [
    "すぐに試せる具体的なアドバイス1",
    "すぐに試せる具体的なアドバイス2",
    "すぐに試せる具体的なアドバイス3"
  ],
  "hashtags": ["#AI", "#関連タグ5つ程度"],
  "imageKeywords": ["画像生成に使えるキーワード（例: AI interface, code editor, chatbot）"],
  "sources": ["参考にした情報源"]
}`;
  }

  /**
   * AI/テック系のリサーチプロンプト（同期版・後方互換用）
   */
  private getAIResearchPrompt(): string {
    return `あなたはAI・テクノロジーの最新動向に詳しいリサーチャーです。
2025年後半〜2026年1月現在の最新AIトレンドをリサーチしてください。

【最新トピック（必ずこれらから選択）】
- Claude Opus 4.5 / Claude 4（最新）
- GPT-4o / GPT-5（最新）
- Gemini 2.0 / Gemini Ultra
- Cursor AI / Windsurf
- Sora（動画生成）
- NotebookLM
- Perplexity AI

【使用禁止（古い情報）】
- Claude 3.5 Sonnet（Claude Opus 4.5が最新）
- GPT-4（GPT-4o/GPT-5が最新）
- Midjourney v5（v6.1以降が最新）
- 2024年以前のニュース

【出力形式（JSON）】
{
  "topic": "具体的なトピック名（最新トピックから選択）",
  "description": "このトピックの概要説明（100文字程度）",
  "whyTrending": "なぜ今話題なのか（50文字程度）",
  "keyPoints": [
    "重要ポイント1（具体的に）",
    "重要ポイント2（具体的に）",
    "重要ポイント3（具体的に）"
  ],
  "practicalTips": [
    "すぐに試せる具体的なアドバイス1",
    "すぐに試せる具体的なアドバイス2",
    "すぐに試せる具体的なアドバイス3"
  ],
  "hashtags": ["#AI", "#関連タグ5つ程度"],
  "imageKeywords": ["画像生成に使えるキーワード（例: AI interface, code editor, chatbot）"],
  "sources": ["参考にした情報源"]
}`;
  }

  /**
   * ビジネス/副業系のリサーチプロンプト（デザインルール連携版）
   */
  private async getBusinessResearchPromptWithRules(): Promise<string> {
    const currentTopics = await designRules.getCurrentBusinessTopics();

    return `あなたは副業・ビジネストレンドに詳しいリサーチャーです。
2025年後半〜2026年1月現在の最新の稼ぎ方・副業トレンドをリサーチしてください。

【最新トピック一覧（必ずこれらから選択）】
${currentTopics.map(t => `- ${t}`).join('\n')}

【調査対象】
- AI活用の副業（AI画像でLINEスタンプ、ChatGPTでKindle出版等）
- クリエイター収益（YouTube, TikTok, Instagram収益化）
- スキル販売（ココナラ, ストアカ, タイムチケット等）
- プロンプト販売（PromptBase等）
- YouTube/TikTokで話題の副業法

【重要】以下の点を必ず含めてください：
- 初期費用ゼロから始められる方法
- 具体的な収益目安（月額）
- 実際の成功例
- 2026年1月現在の最新情報のみ使用

【出力形式（JSON）】
{
  "topic": "具体的な副業/ビジネストピック名（最新トピックから選択）",
  "description": "このトピックの概要説明（100文字程度）",
  "whyTrending": "なぜ今話題なのか（50文字程度）",
  "keyPoints": [
    "重要ポイント1（具体的な数字を含む）",
    "重要ポイント2",
    "重要ポイント3"
  ],
  "practicalTips": [
    "今日から始められる具体的なステップ1",
    "ステップ2",
    "ステップ3"
  ],
  "hashtags": ["#副業", "#関連タグ5つ程度"],
  "imageKeywords": ["money, growth chart, laptop work等"],
  "sources": ["参考にした情報源"]
}`;
  }

  /**
   * ビジネス/副業系のリサーチプロンプト
   */
  private getBusinessResearchPrompt(): string {
    return `あなたは副業・ビジネストレンドに詳しいリサーチャーです。
2025年後半〜2026年1月現在の最新の稼ぎ方・副業トレンドをリサーチしてください。

【最新トピック（必ずこれらから選択）】
- AI画像でLINEスタンプ販売
- AIでKindle出版
- プロンプト販売（PromptBase等）
- AI動画でYouTube収益化
- Canva×AIでデザイン素材販売

【調査対象】
- AI活用の副業（AI画像でLINEスタンプ、ChatGPTでKindle出版等）
- クリエイター収益（YouTube, TikTok, Instagram収益化）
- スキル販売（ココナラ, ストアカ, タイムチケット等）
- プロンプト販売（PromptBase等）
- YouTube/TikTokで話題の副業法

【重要】以下の点を必ず含めてください：
- 初期費用ゼロから始められる方法
- 具体的な収益目安（月額）
- 実際の成功例

【出力形式（JSON）】
{
  "topic": "具体的な副業/ビジネストピック名",
  "description": "このトピックの概要説明（100文字程度）",
  "whyTrending": "なぜ今話題なのか（50文字程度）",
  "keyPoints": [
    "重要ポイント1（具体的な数字を含む）",
    "重要ポイント2",
    "重要ポイント3"
  ],
  "practicalTips": [
    "今日から始められる具体的なステップ1",
    "ステップ2",
    "ステップ3"
  ],
  "hashtags": ["#副業", "#関連タグ5つ程度"],
  "imageKeywords": ["money, growth chart, laptop work等"],
  "sources": ["参考にした情報源"]
}`;
  }

  /**
   * 教育系のリサーチプロンプト
   */
  private getEducationResearchPrompt(): string {
    return `あなたは教育トレンドに詳しいリサーチャーです。
2024年後半〜2025年1月現在の最新の教育・学習トレンドをリサーチしてください。

【調査対象】
- プログラミング教育の最新動向
- AI時代に必要なスキル
- 子供のデジタルリテラシー
- オンライン学習の新しい形
- 探究学習・STEAM教育

【重要】以下の点を必ず含めてください：
- 保護者が知っておくべき具体的な情報
- 家庭でできる実践的なアドバイス
- 2030年を見据えた視点

【出力形式（JSON）】
{
  "topic": "具体的な教育トピック名",
  "description": "このトピックの概要説明（100文字程度）",
  "whyTrending": "なぜ今話題なのか（50文字程度）",
  "keyPoints": [
    "重要ポイント1",
    "重要ポイント2",
    "重要ポイント3"
  ],
  "practicalTips": [
    "保護者ができる具体的なアクション1",
    "アクション2",
    "アクション3"
  ],
  "hashtags": ["#教育", "#関連タグ5つ程度"],
  "imageKeywords": ["children learning, coding, future skills等"],
  "sources": ["参考にした情報源"]
}`;
  }

  /**
   * 開発物紹介のリサーチプロンプト
   */
  private getDevelopmentResearchPrompt(): string {
    return `あなたはプログラミング・開発トレンドに詳しいリサーチャーです。
2024年後半〜2025年1月現在の話題の開発プロジェクトやアプリのアイデアをリサーチしてください。

【調査対象】
- 学生が作れる話題のアプリアイデア
- バズったインディー開発プロジェクト
- AI活用の開発事例
- ゲーム開発（Unity, Unreal, Godot）
- Web開発（Next.js, Remix等）

【重要】以下の点を必ず含めてください：
- 実際に作って公開された事例
- 技術的なポイント
- なぜバズったのかの分析

【出力形式（JSON）】
{
  "topic": "具体的な開発プロジェクト/アプリ名",
  "description": "このトピックの概要説明（100文字程度）",
  "whyTrending": "なぜ今話題なのか（50文字程度）",
  "keyPoints": [
    "技術的なポイント1",
    "ポイント2",
    "ポイント3"
  ],
  "practicalTips": [
    "自分で作るためのヒント1",
    "ヒント2",
    "ヒント3"
  ],
  "hashtags": ["#プログラミング", "#関連タグ5つ程度"],
  "imageKeywords": ["code editor, app interface, game screenshot等"],
  "sources": ["参考にした情報源"]
}`;
  }

  /**
   * 活動報告用のリサーチプロンプト
   */
  private getActivityResearchPrompt(): string {
    return `プログラミング教室の活動報告用のトピックを生成してください。
実際の教室での活動を想定した内容にしてください。

【活動例】
- eスポーツ大会への参加
- ゲーム開発発表会
- プログラミングワークショップ
- メディア出演・取材
- 地域イベントへの参加

【出力形式（JSON）】
{
  "topic": "活動内容（例: ゲーム開発発表会に参加）",
  "description": "活動の概要",
  "whyTrending": "この活動の意義",
  "keyPoints": ["活動のハイライト1", "ハイライト2", "ハイライト3"],
  "practicalTips": ["学んだこと1", "学んだこと2", "学んだこと3"],
  "hashtags": ["#活動報告", "#if塾", "関連タグ"],
  "imageKeywords": ["team activity, event, presentation等"],
  "sources": []
}`;
  }

  /**
   * お知らせ用のリサーチプロンプト
   */
  private getAnnouncementResearchPrompt(): string {
    return `プログラミング教室のお知らせ用のトピックを生成してください。
実際の教室の告知を想定した内容にしてください。

【お知らせ例】
- 無料体験会の告知
- 新規コース開設
- イベント参加者募集
- 新サービス開始

【出力形式（JSON）】
{
  "topic": "お知らせ内容（例: 春の無料体験会開催）",
  "description": "お知らせの概要",
  "whyTrending": "このお知らせの価値",
  "keyPoints": ["ポイント1", "ポイント2", "ポイント3"],
  "practicalTips": ["参加方法1", "方法2", "方法3"],
  "hashtags": ["#お知らせ", "#if塾", "関連タグ"],
  "imageKeywords": ["announcement, event, education等"],
  "sources": []
}`;
  }

  /**
   * デフォルトのトレンド情報を取得
   * デザインルールに基づいて最新トピックを使用
   */
  private getDefaultTrend(category: CategoryType): TrendInfo {
    const defaults: Record<CategoryType, TrendInfo> = {
      ai: {
        topic: 'Claude Opus 4.5の活用法',
        description: 'Anthropicの最新AIモデルClaude Opus 4.5の効果的な使い方。業界最高クラスの性能を持つ大規模言語モデル。',
        whyTrending: '2025年末リリースの最新モデルで、推論能力が大幅向上',
        keyPoints: ['最高クラスのコード生成能力', 'Claude Codeで開発効率10倍', '複雑な推論タスクに強い'],
        practicalTips: ['Claude Codeをターミナルで使う', '長文タスクはOpusで、短文はSonnetで', 'Artifactsでリアルタイムプレビュー'],
        hashtags: ['#AI', '#Claude', '#ClaudeOpus', '#生成AI', '#プログラミング', '#2026'],
        imageKeywords: ['AI chat interface', 'code generation', 'Claude AI', 'modern workspace'],
        sources: ['Anthropic公式']
      },
      business: {
        topic: 'AI画像でLINEスタンプ販売',
        description: 'Midjourney等のAI画像生成でLINEスタンプを作成・販売する方法',
        whyTrending: '初期費用ゼロで始められる新しい副業',
        keyPoints: ['月1万円〜10万円の収益例', '1セット40個作成', '審査は約1週間'],
        practicalTips: ['キャラクターを統一', '表情バリエーションを増やす', 'ニッチなテーマを選ぶ'],
        hashtags: ['#副業', '#LINEスタンプ', '#AI画像', '#不労所得', '#クリエイター'],
        imageKeywords: ['LINE sticker', 'cute character', 'digital art'],
        sources: ['LINE Creators Market']
      },
      education: {
        topic: 'AI時代のプログラミング教育',
        description: 'AIツールを活用した新しいプログラミング学習法',
        whyTrending: 'AIがコードを書く時代に何を学ぶべきか',
        keyPoints: ['論理的思考力が重要', 'AIとの協働スキル', '問題解決能力'],
        practicalTips: ['AIに質問する習慣', '自分で考えてからAIに確認', 'エラーの読み方を学ぶ'],
        hashtags: ['#プログラミング教育', '#AI教育', '#子供の習い事', '#STEM'],
        imageKeywords: ['children coding', 'programming class', 'future education'],
        sources: ['文部科学省']
      },
      development: {
        topic: '学生が作ったバズアプリ',
        description: '高校生・大学生が開発してバズった話題のアプリ紹介',
        whyTrending: '若い開発者の活躍が注目を集めている',
        keyPoints: ['シンプルなアイデア', 'ニッチな需要を狙う', 'SNSでの拡散'],
        practicalTips: ['まず小さく作る', 'ユーザーの声を聞く', '継続的に改善'],
        hashtags: ['#アプリ開発', '#学生開発者', '#インディー開発', '#プログラミング'],
        imageKeywords: ['app interface', 'mobile app', 'young developer'],
        sources: []
      },
      activity: {
        topic: 'if塾の活動報告',
        description: '最近の授業や活動の様子をお伝えします',
        whyTrending: '日々成長する生徒たちの姿',
        keyPoints: ['実践的な学び', 'チームワーク', '楽しみながら成長'],
        practicalTips: ['興味を持ったら体験へ', '見学歓迎', '気軽にお問い合わせ'],
        hashtags: ['#活動報告', '#if塾', '#プログラミング教室', '#秋田'],
        imageKeywords: ['classroom activity', 'team work', 'programming class'],
        sources: []
      },
      announcement: {
        topic: '無料体験会のお知らせ',
        description: 'if塾の無料体験会を開催します',
        whyTrending: 'プログラミングを始めるチャンス',
        keyPoints: ['完全無料', '手ぶらでOK', '初心者歓迎'],
        practicalTips: ['事前予約がおすすめ', '保護者同伴OK', '質問も歓迎'],
        hashtags: ['#無料体験', '#if塾', '#プログラミング教室', '#秋田'],
        imageKeywords: ['event announcement', 'workshop', 'education'],
        sources: []
      }
    };

    return defaults[category];
  }
}

export const trendResearcher = new TrendResearcher();
