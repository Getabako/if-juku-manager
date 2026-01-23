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

// カテゴリごとの検索キーワード
const CATEGORY_SEARCH_QUERIES: Record<CategoryType, string[]> = {
  ai: [
    '最新 AI ニュース 2025',
    'ChatGPT Claude Gemini 新機能',
    '生成AI 企業活用 事例',
    'AIエージェント 最新動向',
    'OpenAI Anthropic Google AI 発表',
  ],
  business: [
    'AI ビジネス活用 成功事例 2025',
    'DX推進 企業 最新',
    'スタートアップ AI 資金調達',
    'ビジネス 生産性向上 AI',
  ],
  education: [
    'AI 教育 プログラミング教室 最新',
    '子供 プログラミング学習 トレンド',
    'STEM教育 日本 2025',
    'AI時代 教育 変化',
  ],
  development: [
    'プログラミング 最新トレンド 2025',
    'GitHub Copilot 新機能',
    'AIコーディング ツール 比較',
    'ソフトウェア開発 生産性 AI',
  ],
  activity: [
    'eスポーツ 子供 教育',
    'プログラミング イベント 2025',
    'IT教室 イベント 最新',
  ],
  announcement: [
    'AI イベント セミナー 2025',
    'プログラミング教室 最新情報',
    'IT教育 展示会',
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

  constructor() {
    const config = getConfig();
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    // Grounding with Google Searchを使用
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });
  }

  /**
   * Geminiのグラウンディング機能で最新情報を検索
   */
  private async searchWithGrounding(query: string): Promise<string> {
    const prompt = `以下のトピックについて、最新の情報を調べて詳細に報告してください。
情報は必ず2024年以降の最新のものを含めてください。

トピック: ${query}

以下の形式で報告してください：
1. 最新ニュースの見出し（具体的に）
2. 詳細情報（数値やデータを含む）
3. 影響や意味（業界への影響）
4. 情報源（可能であればURLも）`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.warn(`検索失敗: ${query}`);
      return '';
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

    const prompt = `以下の検索結果を分析し、Instagram投稿に最適な1つのトピックを選び、構造化された情報を抽出してください。

【検索結果】
${combinedText}

【選定基準】
1. 最新（2024年以降）で、今知るべき重要な情報
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

重要: 抽象的な表現ではなく、必ず具体的な数値やデータを含めてください。`;

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
   * 特定のトピックについて深掘りリサーチ
   */
  async deepDiveResearch(topic: string): Promise<string> {
    logger.info(`深掘りリサーチ: ${topic}`);

    const prompt = `「${topic}」について、以下の観点から詳細に調べてください：

1. 最新の動向（2024年以降）
2. 具体的な数値やデータ
3. 成功事例や活用事例
4. 課題や注意点
5. 今後の展望

具体的で詳細な情報を提供してください。抽象的な説明ではなく、数値やデータに基づいた情報を重視してください。`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      logger.warn(`深掘りリサーチ失敗: ${topic}`);
      return '';
    }
  }
}

export const newsResearcher = new NewsResearcher();
