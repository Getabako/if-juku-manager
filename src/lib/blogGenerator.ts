/**
 * ブログ生成モジュール
 * 最新ニュース情報から詳細なブログ記事を生成し、
 * そこからInstagram投稿用の要約を抽出する
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { getConfig, PATHS } from './config.js';
import { logger } from './logger.js';
import type { CategoryType, Slide } from './types.js';

// 最新ニュース情報の型
export interface NewsInfo {
  headline: string;        // ニュースの見出し
  summary: string;         // 要約
  details: string[];       // 詳細情報
  comparison?: string;     // 以前との比較（あれば）
  implications: string[];  // 影響・意味
  sources: string[];       // 情報源URL
  date: string;           // 調査日
}

// ブログ記事の型
export interface BlogArticle {
  title: string;
  introduction: string;    // 導入文
  sections: {
    heading: string;
    content: string;
    keyPoints: string[];
  }[];
  conclusion: string;
  metadata: {
    category: CategoryType;
    newsSource: NewsInfo;
    generatedAt: string;
  };
}

// Instagram投稿用の要約
export interface InstagramSummary {
  title: string;
  slides: Slide[];
  caption: string;
  keyTakeaways: string[];  // 具体的なポイント
}

export class BlogGenerator {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const config = getConfig();
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  /**
   * 最新ニュース情報から詳細なブログ記事を生成
   */
  async generateBlogFromNews(
    newsInfo: NewsInfo,
    category: CategoryType
  ): Promise<BlogArticle> {
    logger.info('ブログ記事を生成中...');

    const prompt = `あなたは技術ライターです。以下のニュース情報に基づいて、詳細で有益なブログ記事を執筆してください。

【ニュース情報】
見出し: ${newsInfo.headline}
要約: ${newsInfo.summary}
詳細:
${newsInfo.details.map((d, i) => `${i + 1}. ${d}`).join('\n')}
${newsInfo.comparison ? `\n以前との比較: ${newsInfo.comparison}` : ''}
影響・意味:
${newsInfo.implications.map((i, idx) => `- ${i}`).join('\n')}
情報源: ${newsInfo.sources.join(', ')}

【執筆要件】
1. 単なる表面的な紹介ではなく、具体的な数値やデータを含める
2. 以前のバージョン/状況と比較して「何が変わったか」を明確にする
3. 読者が実際に活用できる具体的なアクションを提示
4. 専門用語は分かりやすく説明
5. 1500〜2000文字程度の詳細な記事

【出力形式（JSON）】
{
  "title": "記事タイトル（SEOを意識、具体的に）",
  "introduction": "導入文（200文字程度、読者の興味を引く）",
  "sections": [
    {
      "heading": "セクション見出し1（具体的に）",
      "content": "セクション内容（300〜400文字、詳細に）",
      "keyPoints": ["重要ポイント1", "重要ポイント2"]
    },
    {
      "heading": "セクション見出し2",
      "content": "セクション内容",
      "keyPoints": ["重要ポイント1", "重要ポイント2"]
    },
    {
      "heading": "セクション見出し3",
      "content": "セクション内容",
      "keyPoints": ["重要ポイント1", "重要ポイント2"]
    }
  ],
  "conclusion": "結論（200文字程度、行動を促す）"
}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('ブログ記事の抽出に失敗');
      }

      const article = JSON.parse(jsonMatch[0]);

      const blogArticle: BlogArticle = {
        ...article,
        metadata: {
          category,
          newsSource: newsInfo,
          generatedAt: new Date().toISOString(),
        },
      };

      logger.success(`ブログ記事生成完了: ${blogArticle.title}`);
      return blogArticle;
    } catch (error) {
      logger.error('ブログ記事生成に失敗');
      throw error;
    }
  }

  /**
   * ブログ記事からInstagram投稿用の要約を生成
   */
  async generateInstagramSummary(
    blog: BlogArticle,
    category: CategoryType
  ): Promise<InstagramSummary> {
    logger.info('Instagram投稿用要約を生成中...');

    const blogContent = `
タイトル: ${blog.title}
導入: ${blog.introduction}
${blog.sections.map(s => `
【${s.heading}】
${s.content}
重要ポイント: ${s.keyPoints.join('、')}`).join('\n')}
結論: ${blog.conclusion}
`;

    const prompt = `以下のブログ記事をInstagram投稿用に要約してください。

【ブログ記事】
${blogContent}

【要件】
1. 4枚のスライド構成（表紙1枚 + 内容3枚）
2. 各スライドは具体的で有益な情報のみ
3. 「〜の鍵」「〜の革新」など抽象的な表現は禁止
4. 具体的な数値、比較、アクションを含める
5. 絵文字禁止、落ち着いた広報向けの文体

【具体性の例】
悪い例: 「AIがビジネスを革新」
良い例: 「ChatGPTシェア22%減、Geminiが21.5%に躍進」

悪い例: 「効率が向上」
良い例: 「コード生成時間が従来の1/3に短縮」

【出力形式（JSON）】
{
  "title": "投稿タイトル（具体的に）",
  "slides": [
    {
      "type": "cover",
      "headline": "具体的な数値や事実を含むキャッチーな見出し（20文字以内）",
      "subtext": "サブテキスト"
    },
    {
      "type": "content",
      "headline": "具体的な見出し",
      "points": [
        "具体的な数値やデータを含むポイント1",
        "比較情報を含むポイント2",
        "実践的なアクションを含むポイント3"
      ]
    },
    {
      "type": "content",
      "headline": "具体的な見出し",
      "points": ["具体的なポイント1", "具体的なポイント2", "具体的なポイント3"]
    },
    {
      "type": "content",
      "headline": "具体的な見出し",
      "points": ["具体的なポイント1", "具体的なポイント2", "具体的なポイント3"]
    }
  ],
  "caption": "Instagram用キャプション（絵文字禁止、300文字程度、ハッシュタグ込み）",
  "keyTakeaways": [
    "読者が得られる具体的な価値1",
    "読者が得られる具体的な価値2",
    "読者が得られる具体的な価値3"
  ]
}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Instagram要約の抽出に失敗');
      }

      const summary = JSON.parse(jsonMatch[0]) as InstagramSummary;
      logger.success(`Instagram要約生成完了: ${summary.title}`);
      return summary;
    } catch (error) {
      logger.error('Instagram要約生成に失敗');
      throw error;
    }
  }

  /**
   * ブログ記事を保存
   */
  async saveBlog(blog: BlogArticle, topicId: string): Promise<string> {
    const blogsDir = path.join(PATHS.generated, 'blogs');
    await fs.mkdir(blogsDir, { recursive: true });

    const filename = `${topicId}_blog.json`;
    const filepath = path.join(blogsDir, filename);

    await fs.writeFile(filepath, JSON.stringify(blog, null, 2), 'utf-8');
    logger.info(`ブログを保存: ${filepath}`);

    // Markdown形式でも保存
    const mdContent = this.blogToMarkdown(blog);
    const mdFilepath = path.join(blogsDir, `${topicId}_blog.md`);
    await fs.writeFile(mdFilepath, mdContent, 'utf-8');
    logger.info(`ブログ(MD)を保存: ${mdFilepath}`);

    return filepath;
  }

  /**
   * ブログ記事をMarkdown形式に変換
   */
  private blogToMarkdown(blog: BlogArticle): string {
    let md = `# ${blog.title}\n\n`;
    md += `*生成日: ${blog.metadata.generatedAt}*\n`;
    md += `*カテゴリ: ${blog.metadata.category}*\n\n`;
    md += `---\n\n`;
    md += `${blog.introduction}\n\n`;

    for (const section of blog.sections) {
      md += `## ${section.heading}\n\n`;
      md += `${section.content}\n\n`;
      if (section.keyPoints.length > 0) {
        md += `**重要ポイント:**\n`;
        for (const point of section.keyPoints) {
          md += `- ${point}\n`;
        }
        md += `\n`;
      }
    }

    md += `## まとめ\n\n`;
    md += `${blog.conclusion}\n\n`;

    md += `---\n\n`;
    md += `**情報源:**\n`;
    for (const source of blog.metadata.newsSource.sources) {
      md += `- ${source}\n`;
    }

    return md;
  }

  /**
   * 過去のブログ一覧を取得
   */
  async getPastBlogs(limit: number = 10): Promise<BlogArticle[]> {
    const blogsDir = path.join(PATHS.generated, 'blogs');

    try {
      const files = await fs.readdir(blogsDir);
      const blogFiles = files
        .filter(f => f.endsWith('_blog.json'))
        .sort()
        .reverse()
        .slice(0, limit);

      const blogs: BlogArticle[] = [];
      for (const file of blogFiles) {
        const content = await fs.readFile(path.join(blogsDir, file), 'utf-8');
        blogs.push(JSON.parse(content));
      }

      return blogs;
    } catch {
      return [];
    }
  }
}

export const blogGenerator = new BlogGenerator();
