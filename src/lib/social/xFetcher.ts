/**
 * X(Twitter)投稿管理モジュール
 *
 * X APIは有料化されたため、2つのアプローチを提供:
 * 1. 手動エクスポート: Xの設定からデータをダウンロードして読み込む
 * 2. 投稿時保存: 投稿する際に同時にローカルに保存する
 */

import * as fs from 'fs';
import * as path from 'path';

// 投稿データの型定義
export interface XPost {
  id: string;
  text: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  media_keys?: string[];
  url?: string;
}

export interface XPostsArchive {
  fetched_at: string;
  username: string;
  total_posts: number;
  posts: XPost[];
  writing_style: XWritingStyleAnalysis;
}

export interface XWritingStyleAnalysis {
  average_length: number;
  hashtag_usage: string[];
  emoji_usage: string[];
  mention_patterns: string[];
  posting_hours: number[];
  tone_keywords: string[];
}

const DATA_DIR = path.join(process.cwd(), 'data', 'social');
const POSTS_FILE = path.join(DATA_DIR, 'x_posts.json');

/**
 * X(Twitter)のデータエクスポートファイルを読み込む
 *
 * Xの設定 > アカウント > データのアーカイブをダウンロード から取得したZIPを展開し、
 * tweets.js ファイルのパスを指定
 */
export async function importFromXArchive(tweetsJsPath: string): Promise<XPost[]> {
  if (!fs.existsSync(tweetsJsPath)) {
    console.error(`File not found: ${tweetsJsPath}`);
    return [];
  }

  let content = fs.readFileSync(tweetsJsPath, 'utf-8');

  // tweets.jsは "window.YTD.tweet.part0 = [...]" 形式
  // JSON部分だけ抽出
  content = content.replace(/^window\.YTD\.tweet\.part\d+\s*=\s*/, '');

  try {
    const tweets = JSON.parse(content);

    return tweets.map((t: any) => ({
      id: t.tweet.id,
      text: t.tweet.full_text,
      created_at: t.tweet.created_at,
      public_metrics: {
        retweet_count: parseInt(t.tweet.retweet_count) || 0,
        reply_count: 0,
        like_count: parseInt(t.tweet.favorite_count) || 0,
        quote_count: 0,
      },
    }));
  } catch (error) {
    console.error('Error parsing tweets.js:', error);
    return [];
  }
}

/**
 * 手動で投稿を追加（投稿時に同時保存用）
 */
export function addPost(post: Omit<XPost, 'id' | 'created_at'>): XPost {
  const archive = loadPostsArchive() || {
    fetched_at: new Date().toISOString(),
    username: 'getabakoclub',
    total_posts: 0,
    posts: [],
    writing_style: {
      average_length: 0,
      hashtag_usage: [],
      emoji_usage: [],
      mention_patterns: [],
      posting_hours: [],
      tone_keywords: [],
    },
  };

  const newPost: XPost = {
    id: `manual_${Date.now()}`,
    created_at: new Date().toISOString(),
    ...post,
  };

  archive.posts.unshift(newPost);
  archive.total_posts = archive.posts.length;
  archive.fetched_at = new Date().toISOString();
  archive.writing_style = analyzeWritingStyle(archive.posts);

  saveArchive(archive);

  return newPost;
}

/**
 * 投稿から文体パターンを分析
 */
export function analyzeWritingStyle(posts: XPost[]): XWritingStyleAnalysis {
  const texts = posts.map(p => p.text).filter(Boolean);

  if (texts.length === 0) {
    return {
      average_length: 0,
      hashtag_usage: [],
      emoji_usage: [],
      mention_patterns: [],
      posting_hours: [],
      tone_keywords: [],
    };
  }

  // 平均文字数
  const totalLength = texts.reduce((sum, t) => sum + t.length, 0);
  const average_length = Math.round(totalLength / texts.length);

  // ハッシュタグ抽出
  const hashtagCount: Record<string, number> = {};
  texts.forEach(text => {
    const hashtags = text.match(/#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/g) || [];
    hashtags.forEach(tag => {
      hashtagCount[tag] = (hashtagCount[tag] || 0) + 1;
    });
  });
  const hashtag_usage = Object.entries(hashtagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);

  // 絵文字抽出
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  const allEmojis = texts.join('').match(emojiRegex) || [];
  const emojiCount = allEmojis.reduce((acc: Record<string, number>, emoji) => {
    acc[emoji] = (acc[emoji] || 0) + 1;
    return acc;
  }, {});
  const emoji_usage = Object.entries(emojiCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emoji]) => emoji);

  // メンションパターン
  const mentionCount: Record<string, number> = {};
  texts.forEach(text => {
    const mentions = text.match(/@\w+/g) || [];
    mentions.forEach(mention => {
      mentionCount[mention] = (mentionCount[mention] || 0) + 1;
    });
  });
  const mention_patterns = Object.entries(mentionCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([mention]) => mention);

  // 投稿時間帯
  const hourCount: Record<number, number> = {};
  posts.forEach(post => {
    const hour = new Date(post.created_at).getHours();
    hourCount[hour] = (hourCount[hour] || 0) + 1;
  });
  const posting_hours = Object.entries(hourCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour]) => parseInt(hour));

  // トーンキーワード
  const tonePatterns = [
    { pattern: /開発|実装|コード|プログラ|AI|システム/g, tone: 'tech' },
    { pattern: /嬉しい|楽しい|最高|ありがとう/g, tone: 'positive' },
    { pattern: /リリース|公開|完成|達成/g, tone: 'achievement' },
    { pattern: /学び|勉強|成長|挑戦/g, tone: 'learning' },
    { pattern: /！|!|🔥|💪|🚀/g, tone: 'energetic' },
  ];

  const toneScores: Record<string, number> = {};
  texts.forEach(text => {
    tonePatterns.forEach(({ pattern, tone }) => {
      const matches = text.match(pattern) || [];
      toneScores[tone] = (toneScores[tone] || 0) + matches.length;
    });
  });

  const tone_keywords = Object.entries(toneScores)
    .sort((a, b) => b[1] - a[1])
    .map(([tone]) => tone);

  return {
    average_length,
    hashtag_usage,
    emoji_usage,
    mention_patterns,
    posting_hours,
    tone_keywords,
  };
}

/**
 * アーカイブを保存
 */
function saveArchive(archive: XPostsArchive): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(POSTS_FILE, JSON.stringify(archive, null, 2), 'utf-8');
  console.log(`Saved ${archive.total_posts} posts to ${POSTS_FILE}`);

  // NotebookLM用Markdownも生成
  generateMarkdownForNotebookLM(archive);
}

/**
 * NotebookLM用のMarkdown生成
 */
export function generateMarkdownForNotebookLM(archive: XPostsArchive): string {
  const mdPath = path.join(DATA_DIR, 'x_posts_for_notebooklm.md');

  let content = `# @${archive.username}のX(Twitter)投稿アーカイブ

## 文体分析

- **平均投稿文字数**: ${archive.writing_style.average_length}文字
- **よく使うハッシュタグ**: ${archive.writing_style.hashtag_usage.slice(0, 10).join(' ')}
- **よく使う絵文字**: ${archive.writing_style.emoji_usage.join(' ')}
- **投稿トーン**: ${archive.writing_style.tone_keywords.join(', ')}
- **アクティブな時間帯**: ${archive.writing_style.posting_hours.map(h => `${h}時`).join(', ')}

---

## 投稿一覧

`;

  // 投稿を新しい順に追加
  archive.posts
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .forEach((post, index) => {
      const date = new Date(post.created_at).toLocaleDateString('ja-JP');
      content += `### ${index + 1}. ${date}\n\n`;
      content += `${post.text}\n\n`;
      if (post.public_metrics) {
        content += `❤️ ${post.public_metrics.like_count} 🔁 ${post.public_metrics.retweet_count}\n`;
      }
      content += '\n---\n\n';
    });

  fs.writeFileSync(mdPath, content, 'utf-8');
  console.log(`Generated Markdown for NotebookLM: ${mdPath}`);

  return mdPath;
}

/**
 * 保存済みの投稿を読み込む
 */
export function loadPostsArchive(): XPostsArchive | null {
  if (!fs.existsSync(POSTS_FILE)) {
    return null;
  }

  const data = fs.readFileSync(POSTS_FILE, 'utf-8');
  return JSON.parse(data);
}

/**
 * 投稿をインポートして保存
 */
export async function importAndSaveXPosts(tweetsJsPath: string, username: string): Promise<XPostsArchive | null> {
  console.log(`Importing X posts from: ${tweetsJsPath}`);

  const posts = await importFromXArchive(tweetsJsPath);
  if (posts.length === 0) {
    console.log('No posts found.');
    return null;
  }

  const writingStyle = analyzeWritingStyle(posts);

  const archive: XPostsArchive = {
    fetched_at: new Date().toISOString(),
    username,
    total_posts: posts.length,
    posts,
    writing_style: writingStyle,
  };

  saveArchive(archive);

  return archive;
}
