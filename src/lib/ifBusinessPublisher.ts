/**
 * if-Business ブログ連携モジュール
 * ブログ記事をif-Businessサイトのblog/posts/にJSON保存し、index.jsonを更新
 */
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import type { BlogArticle } from './blogGenerator.js';

const IF_BUSINESS_BLOG_DIR = path.join(
  process.env.HOME || '~',
  'Desktop/ifJukuManager/WebSite/if-Business/blog/posts'
);

interface BlogIndexEntry {
  slug: string;
  title: string;
  category: string;
  date: string;
  introduction: string;
  file: string;
}

export class IfBusinessPublisher {
  /**
   * ブログ記事をif-Businessに保存
   */
  async publishBlog(blog: BlogArticle): Promise<string> {
    try {
      await fs.mkdir(IF_BUSINESS_BLOG_DIR, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const slug = this.generateSlug(blog.title);
      const filename = `${date}-${slug}.json`;
      const filepath = path.join(IF_BUSINESS_BLOG_DIR, filename);

      // ブログ記事をJSON保存
      await fs.writeFile(filepath, JSON.stringify(blog, null, 2), 'utf-8');
      logger.info(`if-Businessブログ保存: ${filename}`);

      // index.jsonを更新
      await this.updateIndex({
        slug,
        title: blog.title,
        category: blog.metadata.category,
        date,
        introduction: blog.introduction.slice(0, 200) + '...',
        file: filename,
      });

      logger.success(`if-Businessブログ公開完了: ${filepath}`);
      return filepath;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`if-Businessブログ保存エラー: ${msg}`);
      return '';
    }
  }

  /**
   * index.jsonを更新（記事一覧に追加）
   */
  private async updateIndex(entry: BlogIndexEntry): Promise<void> {
    const indexPath = path.join(IF_BUSINESS_BLOG_DIR, 'index.json');
    let entries: BlogIndexEntry[] = [];

    try {
      const existing = await fs.readFile(indexPath, 'utf-8');
      entries = JSON.parse(existing);
    } catch {
      // ファイルがない場合は空配列
    }

    // 重複チェック（同じslugがあれば上書き）
    entries = entries.filter(e => e.slug !== entry.slug);
    entries.unshift(entry); // 先頭に追加（最新順）

    await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
    logger.info(`index.json更新完了 (${entries.length}件)`);
  }

  /**
   * タイトルからURLスラグを生成
   */
  private generateSlug(title: string): string {
    return title
      .replace(/[^\w\u3000-\u9FFF\u30A0-\u30FF\u3040-\u309F-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .toLowerCase();
  }
}

export const ifBusinessPublisher = new IfBusinessPublisher();
