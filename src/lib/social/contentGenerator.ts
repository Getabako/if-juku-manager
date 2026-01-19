/**
 * パーソナライズドコンテンツ生成モジュール
 *
 * Gemini APIを使用して、高崎さんの文体を真似たコンテンツを生成
 * Facebookの投稿データをコンテキストとして渡す
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

// Gemini API設定
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// プロフィールデータのパス
const PROFILE_DATA_PATH = path.join(
  __dirname,
  '../../../data/social/facebook_posts_for_notebooklm.md'
);

export interface GeneratedPost {
  title: string;
  content: string;
  hashtags: string[];
  platform: 'instagram' | 'x' | 'facebook';
}

/**
 * プロフィールデータを読み込む
 */
function loadProfileData(): string {
  try {
    if (fs.existsSync(PROFILE_DATA_PATH)) {
      return fs.readFileSync(PROFILE_DATA_PATH, 'utf-8');
    }
  } catch (error) {
    console.error('プロフィールデータの読み込みエラー:', error);
  }
  return '';
}

/**
 * Instagram投稿を生成
 */
export async function generateInstagramPost(topic: string): Promise<GeneratedPost | null> {
  const profileData = loadProfileData();

  const prompt = `あなたは高崎翔太のSNS投稿を代筆するアシスタントです。

## 高崎翔太のプロフィールと文体
${profileData}

---

## タスク
上記のプロフィールと文体を参考に、以下のトピックについてInstagram投稿を作成してください。

トピック: ${topic}

## 出力形式（JSON）
{
  "title": "キャッチーなタイトル（1行）",
  "content": "本文（200-300文字、高崎さんの口調で）",
  "hashtags": ["#ハッシュタグ1", "#ハッシュタグ2", ...],
  "platform": "instagram"
}

## 注意点
- 「w」を適度に使う
- 堅くなりすぎない、親しみやすい口調
- AIや教育への前向きな姿勢
- 具体的な数字やエピソードを入れる

JSONのみを出力してください。`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // JSONを抽出
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed as GeneratedPost;
    }
  } catch (error) {
    console.error('Instagram投稿生成エラー:', error);
  }

  return null;
}

/**
 * X(Twitter)投稿を生成
 */
export async function generateXPost(topic: string): Promise<string | null> {
  const profileData = loadProfileData();

  const prompt = `あなたは高崎翔太（@getabakoclub）のX投稿を代筆するアシスタントです。

## 高崎翔太のプロフィールと文体
${profileData}

---

## タスク
上記のプロフィールと文体を参考に、以下のトピックについて140文字以内のツイートを作成してください。

トピック: ${topic}

## 注意点
- 高崎さんの口調を真似る
- 絵文字やハッシュタグも適度に使う
- カジュアルで親しみやすいトーン
- 「w」を使って笑いを入れる

ツイート本文のみを出力してください（JSON不要）。`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    let tweet = result.response.text().trim();

    // 140文字に収める
    if (tweet.length > 140) {
      tweet = tweet.substring(0, 137) + '...';
    }

    return tweet;
  } catch (error) {
    console.error('X投稿生成エラー:', error);
  }

  return null;
}

/**
 * カルーセル投稿のスライドを生成
 */
export async function generateCarouselSlides(
  topic: string,
  slideCount: number = 5
): Promise<string[] | null> {
  const profileData = loadProfileData();

  const prompt = `あなたは高崎翔太のInstagramカルーセル投稿を作成するアシスタントです。

## 高崎翔太のプロフィールと文体
${profileData}

---

## タスク
上記のプロフィールと文体を参考に、以下のトピックについて${slideCount}枚のカルーセル投稿を作成してください。

トピック: ${topic}

## 出力形式（JSON配列）
[
  "スライド1のテキスト（短く、インパクトのある見出し）",
  "スライド2のテキスト（ポイント1）",
  "スライド3のテキスト（ポイント2）",
  "スライド4のテキスト（ポイント3）",
  "スライド5のテキスト（まとめ/CTA）"
]

## 注意点
- 各スライドは短く（30文字以内が理想）
- 視覚的にインパクトのある言葉選び
- 最後のスライドはアクションを促す

JSON配列のみを出力してください。`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // JSON配列を抽出
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as string[];
    }
  } catch (error) {
    console.error('カルーセル生成エラー:', error);
  }

  return null;
}

/**
 * 文体チェック - 生成されたテキストが高崎さんらしいか確認
 */
export async function checkWritingStyle(text: string): Promise<{
  score: number;
  feedback: string;
}> {
  const profileData = loadProfileData();

  const prompt = `あなたは文体分析の専門家です。

## 高崎翔太の文体特徴
${profileData}

---

## タスク
以下のテキストが高崎翔太の文体にどれだけ近いか評価してください。

テキスト:
${text}

## 出力形式（JSON）
{
  "score": 0-100の数値,
  "feedback": "改善点や良い点のフィードバック"
}

JSONのみを出力してください。`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('文体チェックエラー:', error);
  }

  return { score: 0, feedback: 'チェックに失敗しました' };
}
