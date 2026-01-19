/**
 * NotebookLM連携モジュール
 *
 * notebooklm-skill-masterを使用してNotebookLMに質問し、
 * 高崎さんの文体を真似たコンテンツを生成します。
 */

import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// NotebookLM Skillのパス
const NOTEBOOKLM_SKILL_PATH = '/Users/takasaki19841121/Desktop/ifJukuManager/notebooklm-skill-master';

export interface NotebookLMResponse {
  success: boolean;
  answer: string;
  error?: string;
}

export interface ContentIdea {
  title: string;
  content: string;
  hashtags: string[];
  tone: string;
}

/**
 * NotebookLMに質問を送信
 */
export async function askNotebookLM(
  question: string,
  notebookId?: string,
  showBrowser: boolean = false
): Promise<NotebookLMResponse> {
  try {
    // 認証状態を確認
    const authStatus = checkAuthStatus();
    if (!authStatus) {
      return {
        success: false,
        answer: '',
        error: 'NotebookLM未認証。先に認証を行ってください: npm run notebooklm:auth',
      };
    }

    // 質問を実行
    const args = ['scripts/run.py', 'ask_question.py', '--question', question];
    if (notebookId) {
      args.push('--notebook-id', notebookId);
    }
    if (showBrowser) {
      args.push('--show-browser');
    }

    console.log('Asking NotebookLM...');

    const result = execSync(`python ${args.join(' ')}`, {
      cwd: NOTEBOOKLM_SKILL_PATH,
      encoding: 'utf-8',
      timeout: 180000, // 3分タイムアウト
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // 結果をパース（NotebookLMの回答を抽出）
    const answer = extractAnswer(result);

    return {
      success: true,
      answer,
    };
  } catch (error: any) {
    console.error('NotebookLM error:', error.message);
    return {
      success: false,
      answer: '',
      error: error.message,
    };
  }
}

/**
 * 認証状態を確認
 */
export function checkAuthStatus(): boolean {
  try {
    const result = execSync('python scripts/run.py auth_manager.py status', {
      cwd: NOTEBOOKLM_SKILL_PATH,
      encoding: 'utf-8',
      timeout: 30000,
    });

    return result.includes('authenticated') || result.includes('Authenticated');
  } catch {
    return false;
  }
}

/**
 * 認証をセットアップ（ブラウザを開く）
 */
export function setupAuth(): void {
  console.log('Opening browser for NotebookLM authentication...');
  console.log('Please log in to your Google account.\n');

  spawn('python', ['scripts/run.py', 'auth_manager.py', 'setup'], {
    cwd: NOTEBOOKLM_SKILL_PATH,
    stdio: 'inherit',
  });
}

/**
 * ノートブック一覧を取得
 */
export function listNotebooks(): any[] {
  try {
    const result = execSync('python scripts/run.py notebook_manager.py list', {
      cwd: NOTEBOOKLM_SKILL_PATH,
      encoding: 'utf-8',
      timeout: 30000,
    });

    // JSON形式の出力をパース
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 回答テキストを抽出
 */
function extractAnswer(output: string): string {
  // NotebookLMの回答部分を抽出するロジック
  // 出力形式に応じて調整が必要

  // "Answer:" 以降を抽出
  const answerMatch = output.match(/Answer:([\s\S]*?)(?:Is that ALL you need\?|$)/i);
  if (answerMatch) {
    return answerMatch[1].trim();
  }

  // フォールバック: 最後の大きなテキストブロックを返す
  const lines = output.split('\n').filter(line => line.trim().length > 20);
  return lines.slice(-5).join('\n').trim();
}

/**
 * 高崎さんの文体でInstagram投稿を生成
 */
export async function generateInstagramPost(
  topic: string,
  notebookId?: string
): Promise<ContentIdea | null> {
  const question = `
あなたは高崎翔太（if塾の塾頭）のSNS投稿を代筆するアシスタントです。
過去の投稿を参考に、以下のトピックについてInstagram投稿を作成してください。

トピック: ${topic}

以下の形式で回答してください:
【タイトル】
（キャッチーな一言）

【本文】
（200-300文字程度、高崎さんの口調で）

【ハッシュタグ】
（5-10個）

【トーン】
（positive/motivational/educational/casual から1つ）
`;

  const response = await askNotebookLM(question, notebookId);

  if (!response.success) {
    console.error('Failed to generate post:', response.error);
    return null;
  }

  // 回答をパース
  return parseContentIdea(response.answer);
}

/**
 * 回答をContentIdea形式にパース
 */
function parseContentIdea(answer: string): ContentIdea {
  let title = '';
  let content = '';
  let hashtags: string[] = [];
  let tone = 'positive';

  // タイトル抽出
  const titleMatch = answer.match(/【タイトル】\s*([\s\S]*?)(?=【|$)/);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // 本文抽出
  const contentMatch = answer.match(/【本文】\s*([\s\S]*?)(?=【|$)/);
  if (contentMatch) {
    content = contentMatch[1].trim();
  }

  // ハッシュタグ抽出
  const hashtagMatch = answer.match(/【ハッシュタグ】\s*([\s\S]*?)(?=【|$)/);
  if (hashtagMatch) {
    hashtags = hashtagMatch[1].match(/#[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/g) || [];
  }

  // トーン抽出
  const toneMatch = answer.match(/【トーン】\s*(\w+)/);
  if (toneMatch) {
    tone = toneMatch[1].toLowerCase();
  }

  return { title, content, hashtags, tone };
}

/**
 * 高崎さんの文体でX(Twitter)投稿を生成
 */
export async function generateXPost(
  topic: string,
  notebookId?: string
): Promise<string | null> {
  const question = `
あなたは高崎翔太（@getabakoclub）のX投稿を代筆するアシスタントです。
過去の投稿を参考に、以下のトピックについて140文字以内のツイートを作成してください。

トピック: ${topic}

・高崎さんの口調を真似てください
・絵文字やハッシュタグも適度に使ってください
・開発者らしい、親しみやすいトーンで
`;

  const response = await askNotebookLM(question, notebookId);

  if (!response.success) {
    console.error('Failed to generate tweet:', response.error);
    return null;
  }

  // 140文字に収める
  let tweet = response.answer.trim();
  if (tweet.length > 140) {
    tweet = tweet.substring(0, 137) + '...';
  }

  return tweet;
}
