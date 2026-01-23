/**
 * 最新ニュースリサーチモジュール
 * リアルタイムでWeb検索を行い、最新情報を取得
 * 必ず毎回の投稿生成時に実行すること
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import type { CategoryType } from './types.js';
import type { NewsInfo } from './blogGenerator.js';

// 現在の年を取得（検索クエリで使用）
const CURRENT_YEAR = new Date().getFullYear();

// カテゴリごとの検索キーワード（動的に現在年を使用）
const CATEGORY_SEARCH_QUERIES: Record<CategoryType, string[]> = {
  ai: [
    `最新 AI ニュース ${CURRENT_YEAR}年`,
    `ChatGPT Claude Gemini 新機能 ${CURRENT_YEAR}`,
    `生成AI 企業活用 事例 ${CURRENT_YEAR}`,
    `AIエージェント 最新動向 ${CURRENT_YEAR}`,
    `OpenAI Anthropic Google AI 発表 ${CURRENT_YEAR}年1月`,
  ],
  business: [
    `AI ビジネス活用 成功事例 ${CURRENT_YEAR}`,
    `DX推進 企業 最新 ${CURRENT_YEAR}`,
    `スタートアップ AI 資金調達 ${CURRENT_YEAR}`,
    `ビジネス 生産性向上 AI ${CURRENT_YEAR}`,
  ],
  education: [
    `AI 教育 プログラミング教室 最新 ${CURRENT_YEAR}`,
    `子供 プログラミング学習 トレンド ${CURRENT_YEAR}`,
    `STEM教育 日本 ${CURRENT_YEAR}`,
    `AI時代 教育 変化 ${CURRENT_YEAR}`,
  ],
  development: [
    `プログラミング 最新トレンド ${CURRENT_YEAR}`,
    `GitHub Copilot 新機能 ${CURRENT_YEAR}`,
    `AIコーディング ツール 比較 ${CURRENT_YEAR}`,
    `ソフトウェア開発 生産性 AI ${CURRENT_YEAR}`,
  ],
  activity: [
    `eスポーツ 子供 教育 ${CURRENT_YEAR}`,
    `プログラミング イベント ${CURRENT_YEAR}`,
    `IT教室 イベント 最新 ${CURRENT_YEAR}`,
  ],
  announcement: [
    `AI イベント セミナー ${CURRENT_YEAR}`,
    `プログラミング教室 最新情報 ${CURRENT_YEAR}`,
    `IT教育 展示会 ${CURRENT_YEAR}`,
  ],
};

export interface ResearchResult {
  newsInfo: NewsInfo;
  rawSearchResults: SearchResult[];
  category: CategoryType;
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export class NewsResearcher {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private groundingModel: any;

  constructor() {
    const config = getConfig();
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);

    // 通常の生成用モデル
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });

    // Google Search Grounding を有効にしたモデル
    // 【重要】これにより最新情報をリアルタイムでWeb検索できる
    this.groundingModel = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      tools: [{
        googleSearchRetrieval: {
          dynamicRetrievalConfig: {
            mode: 'MODE_DYNAMIC',
            dynamicThreshold: 0.3, // 低い閾値で積極的に検索
          },
        },
      }],
    });
  }

  /**
   * Geminiのグラウンディング機能で最新情報を検索
   * 【重要】googleSearchRetrieval を使用してリアルタイムWeb検索
   */
  private async searchWithGrounding(query: string): Promise<string> {
    const today = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const prompt = `今日は${today}です。

以下のトピックについて、Google検索を使って最新の情報を調べて詳細に報告してください。
【重要】必ず${CURRENT_YEAR}年の最新情報を検索してください。古い情報は使用しないでください。

トピック: ${query}

以下の形式で報告してください：
1. 最新ニュースの見出し（具体的に、日付も含めて）
2. 詳細情報（数値やデータを含む）
3. 影響や意味（業界への影響）
4. 情報源URL`;

    try {
      // グラウンディング機能を使用して検索
      const result = await this.groundingModel.generateContent(prompt);
      const response = await result.response;

      // グラウンディングメタデータを確認（デバッグ用）
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      if (groundingMetadata?.searchEntryPoint) {
        logger.info(`Google検索を実行: ${groundingMetadata.searchEntryPoint.renderedContent?.slice(0, 100) || 'OK'}`);
      }

      return response.text();
    } catch (error) {
      logger.warn(`検索失敗（グラウンディング）: ${query}`);
      // フォールバック: 通常モデルで試行
      try {
        const fallbackResult = await this.model.generateContent(prompt);
        const fallbackResponse = await fallbackResult.response;
        return fallbackResponse.text();
      } catch {
        return '';
      }
    }
  }

  /**
   * カテゴリに基づいて最新ニュースをリサーチ
   * 必ず毎回の投稿生成前に呼び出すこと
   */
  async researchLatestNews(category: CategoryType): Promise<ResearchResult> {
    logger.info('=== 最新ニュースのリサーチを開始 ===');
    logger.info(`カテゴリ: ${category}`);

    const queries = CATEGORY_SEARCH_QUERIES[category] || CATEGORY_SEARCH_QUERIES.ai;
    const searchResults: SearchResult[] = [];
    const rawTexts: string[] = [];

    // 複数のクエリで検索
    for (const query of queries.slice(0, 3)) { // 最初の3つのクエリを使用
      logger.info(`検索中: ${query}`);
      const result = await this.searchWithGrounding(query);
      if (result) {
        rawTexts.push(result);
        // 簡易的にSearchResultに変換
        searchResults.push({
          title: query,
          snippet: result.slice(0, 500),
          url: '',
        });
      }
    }

    if (rawTexts.length === 0) {
      throw new Error('最新情報の取得に失敗しました');
    }

    // 検索結果を統合してNewsInfoを生成
    const newsInfo = await this.synthesizeNewsInfo(rawTexts, category);

    logger.success('最新ニュースのリサーチ完了');

    return {
      newsInfo,
      rawSearchResults: searchResults,
      category,
    };
  }

  /**
   * 検索結果を統合してNewsInfoを生成
   */
  private async synthesizeNewsInfo(
    rawTexts: string[],
    category: CategoryType
  ): Promise<NewsInfo> {
    logger.info('検索結果を統合中...');

    const combinedText = rawTexts.join('\n\n---\n\n');

    const today = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const prompt = `今日は${today}です。

以下の検索結果を分析し、Instagram投稿に最適な1つのトピックを選び、構造化された情報を抽出してください。

【検索結果】
${combinedText}

【選定基準】
1. 【最重要】${CURRENT_YEAR}年の最新情報を優先（古い情報は絶対に選ばない）
2. 具体的な数値やデータが含まれている
3. ビジネスや教育に関連性がある
4. if塾（プログラミング教室・AI開発）の視点で語れる

【出力形式（JSON）】
{
  "headline": "ニュースの見出し（具体的に、30文字以内）",
  "summary": "要約（100文字程度）",
  "details": [
    "具体的な詳細1（数値やデータを含む）",
    "具体的な詳細2",
    "具体的な詳細3"
  ],
  "comparison": "以前との比較（あれば）",
  "implications": [
    "ビジネスへの影響",
    "教育への影響",
    "一般ユーザーへの影響"
  ],
  "sources": ["情報源URL1", "情報源URL2"]
}

【重要】
- 抽象的な表現ではなく、必ず具体的な数値やデータを含めてください
- ${CURRENT_YEAR}年より前の古い情報（GPT-4など過去のリリース）は選ばないでください
- 最新のニュース（直近1週間以内）を優先してください`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('NewsInfoの抽出に失敗');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const newsInfo: NewsInfo = {
        headline: parsed.headline || '最新AIニュース',
        summary: parsed.summary || '',
        details: parsed.details || [],
        comparison: parsed.comparison || undefined,
        implications: parsed.implications || [],
        sources: parsed.sources || [],
        date: new Date().toISOString().split('T')[0],
      };

      logger.success(`トピック選定完了: ${newsInfo.headline}`);
      return newsInfo;
    } catch (error) {
      logger.error('NewsInfo生成エラー');
      throw error;
    }
  }

  /**
   * 特定のトピックについて深掘りリサーチ（グラウンディング使用）
   */
  async deepDiveResearch(topic: string): Promise<string> {
    logger.info(`深掘りリサーチ: ${topic}`);

    const today = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const prompt = `今日は${today}です。

「${topic}」について、Google検索を使って以下の観点から最新情報を詳細に調べてください：

1. 最新の動向（${CURRENT_YEAR}年、特に直近1ヶ月の情報）
2. 具体的な数値やデータ
3. 成功事例や活用事例
4. 課題や注意点
5. 今後の展望

【重要】
- 古い情報ではなく、${CURRENT_YEAR}年の最新情報を必ず含めてください
- 具体的で詳細な情報を提供してください
- 抽象的な説明ではなく、数値やデータに基づいた情報を重視してください`;

    try {
      // グラウンディング機能を使用
      const result = await this.groundingModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.warn(`深掘りリサーチ失敗: ${topic}`);
      return '';
    }
  }
}

export const newsResearcher = new NewsResearcher();
