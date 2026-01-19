/**
 * Facebook投稿取得モジュール
 *
 * Facebook Graph APIを使用して自分の投稿を取得し、
 * 文体学習用のデータとして保存します。
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// 投稿データの型定義
export interface FacebookPost {
  id: string;
  message?: string;
  story?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  type?: string;
  shares?: { count: number };
  reactions?: { summary: { total_count: number } };
  comments?: { summary: { total_count: number } };
}

export interface PostsArchive {
  fetched_at: string;
  user_id: string;
  user_name: string;
  total_posts: number;
  posts: FacebookPost[];
  writing_style: WritingStyleAnalysis;
}

export interface WritingStyleAnalysis {
  average_length: number;
  common_phrases: string[];
  emoji_usage: string[];
  posting_frequency: string;
  tone_keywords: string[];
}

const DATA_DIR = path.join(process.cwd(), 'data', 'social');
const POSTS_FILE = path.join(DATA_DIR, 'facebook_posts.json');

/**
 * Facebook Graph APIから投稿を取得
 */
export async function fetchFacebookPosts(
  accessToken: string,
  limit: number = 100
): Promise<FacebookPost[]> {
  const allPosts: FacebookPost[] = [];
  let nextUrl = `https://graph.facebook.com/v19.0/me/posts?fields=id,message,story,created_time,permalink_url,full_picture,type,shares,reactions.summary(true),comments.summary(true)&limit=${Math.min(limit, 100)}&access_token=${accessToken}`;

  console.log('Fetching Facebook posts...');

  while (nextUrl && allPosts.length < limit) {
    try {
      const response = await axios.get(nextUrl);
      const data = response.data;

      if (data.data && data.data.length > 0) {
        // メッセージがある投稿のみ収集（文体学習用）
        const postsWithMessage = data.data.filter((post: FacebookPost) => post.message);
        allPosts.push(...postsWithMessage);
        console.log(`  Fetched ${allPosts.length} posts so far...`);
      }

      // 次のページがあれば続行
      nextUrl = data.paging?.next || null;
    } catch (error: any) {
      if (error.response?.data?.error) {
        console.error('Facebook API Error:', error.response.data.error.message);
      } else {
        console.error('Error fetching posts:', error.message);
      }
      break;
    }
  }

  console.log(`Total posts with messages: ${allPosts.length}`);
  return allPosts.slice(0, limit);
}

/**
 * 投稿から文体パターンを分析
 */
export function analyzeWritingStyle(posts: FacebookPost[]): WritingStyleAnalysis {
  const messages = posts.map(p => p.message).filter(Boolean) as string[];

  if (messages.length === 0) {
    return {
      average_length: 0,
      common_phrases: [],
      emoji_usage: [],
      posting_frequency: 'unknown',
      tone_keywords: [],
    };
  }

  // 平均文字数
  const totalLength = messages.reduce((sum, msg) => sum + msg.length, 0);
  const average_length = Math.round(totalLength / messages.length);

  // よく使う絵文字を抽出
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  const allEmojis = messages.join('').match(emojiRegex) || [];
  const emojiCount = allEmojis.reduce((acc: Record<string, number>, emoji) => {
    acc[emoji] = (acc[emoji] || 0) + 1;
    return acc;
  }, {});
  const emoji_usage = Object.entries(emojiCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emoji]) => emoji);

  // よく使うフレーズ（2-4文字の繰り返し）
  const phraseCount: Record<string, number> = {};
  messages.forEach(msg => {
    // 文末表現を抽出
    const endings = msg.match(/[！!？?。\n].{0,10}$/g) || [];
    endings.forEach(ending => {
      const clean = ending.replace(/^[！!？?。\n]/, '').trim();
      if (clean.length >= 2) {
        phraseCount[clean] = (phraseCount[clean] || 0) + 1;
      }
    });

    // 挨拶や口癖を抽出
    const greetings = msg.match(/^.{0,20}/g) || [];
    greetings.forEach(greeting => {
      if (greeting.length >= 3 && greeting.length <= 15) {
        phraseCount[greeting] = (phraseCount[greeting] || 0) + 1;
      }
    });
  });

  const common_phrases = Object.entries(phraseCount)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase]) => phrase);

  // 投稿頻度を計算
  const dates = posts.map(p => new Date(p.created_time).toDateString());
  const uniqueDates = new Set(dates);
  const posting_frequency = `${uniqueDates.size} days with posts out of ${posts.length} total posts`;

  // トーンを表すキーワード
  const tonePatterns = [
    { pattern: /嬉しい|楽しい|最高|素晴らしい|ありがとう/g, tone: 'positive' },
    { pattern: /頑張|挑戦|目標|成長/g, tone: 'motivational' },
    { pattern: /思う|感じ|気がする/g, tone: 'reflective' },
    { pattern: /みんな|皆さん|一緒に/g, tone: 'inclusive' },
    { pattern: /！|!|🔥|💪/g, tone: 'energetic' },
  ];

  const toneScores: Record<string, number> = {};
  messages.forEach(msg => {
    tonePatterns.forEach(({ pattern, tone }) => {
      const matches = msg.match(pattern) || [];
      toneScores[tone] = (toneScores[tone] || 0) + matches.length;
    });
  });

  const tone_keywords = Object.entries(toneScores)
    .sort((a, b) => b[1] - a[1])
    .map(([tone]) => tone);

  return {
    average_length,
    common_phrases,
    emoji_usage,
    posting_frequency,
    tone_keywords,
  };
}

/**
 * 投稿データをファイルに保存
 */
export async function savePostsArchive(
  posts: FacebookPost[],
  userId: string,
  userName: string
): Promise<string> {
  // ディレクトリ作成
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const writingStyle = analyzeWritingStyle(posts);

  const archive: PostsArchive = {
    fetched_at: new Date().toISOString(),
    user_id: userId,
    user_name: userName,
    total_posts: posts.length,
    posts,
    writing_style: writingStyle,
  };

  fs.writeFileSync(POSTS_FILE, JSON.stringify(archive, null, 2), 'utf-8');
  console.log(`Saved ${posts.length} posts to ${POSTS_FILE}`);

  // NotebookLM用のMarkdownも生成
  const markdownPath = await generateMarkdownForNotebookLM(archive);

  return POSTS_FILE;
}

/**
 * NotebookLMにアップロードしやすいMarkdown形式で出力
 */
export async function generateMarkdownForNotebookLM(archive: PostsArchive): Promise<string> {
  const mdPath = path.join(DATA_DIR, 'facebook_posts_for_notebooklm.md');

  let content = `# ${archive.user_name}のFacebook投稿アーカイブ

## 文体分析

- **平均投稿文字数**: ${archive.writing_style.average_length}文字
- **よく使う絵文字**: ${archive.writing_style.emoji_usage.join(' ')}
- **投稿トーン**: ${archive.writing_style.tone_keywords.join(', ')}
- **投稿頻度**: ${archive.writing_style.posting_frequency}

## よく使う表現・フレーズ

${archive.writing_style.common_phrases.map(p => `- ${p}`).join('\n')}

---

## 投稿一覧

`;

  // 投稿を新しい順に追加
  archive.posts
    .sort((a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime())
    .forEach((post, index) => {
      const date = new Date(post.created_time).toLocaleDateString('ja-JP');
      content += `### ${index + 1}. ${date}\n\n`;
      content += `${post.message}\n\n`;
      if (post.reactions?.summary?.total_count) {
        content += `リアクション: ${post.reactions.summary.total_count} `;
      }
      if (post.comments?.summary?.total_count) {
        content += `コメント: ${post.comments.summary.total_count}`;
      }
      content += '\n\n---\n\n';
    });

  fs.writeFileSync(mdPath, content, 'utf-8');
  console.log(`Generated Markdown for NotebookLM: ${mdPath}`);

  return mdPath;
}

/**
 * 保存済みの投稿を読み込む
 */
export function loadPostsArchive(): PostsArchive | null {
  if (!fs.existsSync(POSTS_FILE)) {
    return null;
  }

  const data = fs.readFileSync(POSTS_FILE, 'utf-8');
  return JSON.parse(data);
}

/**
 * ユーザー情報を取得
 */
export async function getFacebookUserInfo(accessToken: string): Promise<{ id: string; name: string } | null> {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${accessToken}`
    );
    return response.data;
  } catch (error: any) {
    console.error('Error fetching user info:', error.response?.data?.error?.message || error.message);
    return null;
  }
}

/**
 * メイン実行関数
 */
export async function fetchAndSaveFacebookPosts(accessToken: string, limit: number = 100): Promise<PostsArchive | null> {
  // ユーザー情報取得
  const userInfo = await getFacebookUserInfo(accessToken);
  if (!userInfo) {
    console.error('Failed to get user info. Check your access token.');
    return null;
  }

  console.log(`Fetching posts for: ${userInfo.name} (${userInfo.id})`);

  // 投稿取得
  const posts = await fetchFacebookPosts(accessToken, limit);
  if (posts.length === 0) {
    console.log('No posts found.');
    return null;
  }

  // 保存
  await savePostsArchive(posts, userInfo.id, userInfo.name);

  return loadPostsArchive();
}
