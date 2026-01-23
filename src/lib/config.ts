/**
 * 設定管理モジュール
 */
import dotenv from 'dotenv';
import path from 'path';
import type { AppConfig, LogLevel } from './types.js';

// .envファイルを読み込み
dotenv.config();

// プロジェクトルートのパス
export const PROJECT_ROOT = path.resolve(process.cwd());

// 各ディレクトリのパス
export const PATHS = {
  assets: path.join(PROJECT_ROOT, 'assets'),
  rawPhotos: path.join(PROJECT_ROOT, 'assets', 'raw_photos'),
  generated: path.join(PROJECT_ROOT, 'assets', 'generated'),
  templates: path.join(PROJECT_ROOT, 'assets', 'templates'),
  data: path.join(PROJECT_ROOT, 'data'),
  topics: path.join(PROJECT_ROOT, 'data', 'topics.json'),
} as const;

// 環境変数から設定を読み込み
export function getConfig(): AppConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const instagramAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const outputDir = process.env.OUTPUT_DIR || PATHS.generated;
  const logLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません。.envファイルを確認してください。');
  }

  return {
    geminiApiKey,
    instagramAccountId: instagramAccountId || '',
    instagramAccessToken: instagramAccessToken || '',
    outputDir,
    logLevel,
  };
}

// Publer API設定
export interface PublerConfig {
  apiKey: string;
  workspaceId: string;
  accountId: string;
}

export function getPublerConfig(): PublerConfig {
  const apiKey = process.env.PUBLER_API_KEY;
  const workspaceId = process.env.PUBLER_WORKSPACE_ID;
  const accountId = process.env.PUBLER_ACCOUNT_ID;

  if (!apiKey || !workspaceId || !accountId) {
    throw new Error('Publer設定が不完全です。PUBLER_API_KEY, PUBLER_WORKSPACE_ID, PUBLER_ACCOUNT_ID を.envファイルに設定してください。');
  }

  return { apiKey, workspaceId, accountId };
}

// 画像サイズ定数
export const IMAGE_SIZES = {
  carousel: {
    width: 1080,
    height: 1350,  // 4:5 アスペクト比
  },
  carouselSquare: {
    width: 1080,
    height: 1080,  // 1:1 アスペクト比
  },
  reel: {
    width: 1080,
    height: 1920,  // 9:16 アスペクト比
  },
} as const;

// デフォルトの画像生成プロンプト
export const DEFAULT_PROMPTS = {
  educational: `Professional, modern educational content background image.
    Clean, bright, tech-inspired aesthetic with subtle gradients.
    Abstract geometric shapes, soft lighting.
    Colors: blue, teal, orange accents.
    No text, no people.
    High quality, 4K resolution.`,

  announcement: `Celebratory, exciting announcement background.
    Dynamic, energetic feel with confetti or sparkles.
    Bright, warm colors: orange, yellow, coral.
    Modern, professional look.
    No text, no people.
    High quality, 4K resolution.`,

  successStory: `Inspiring success story background.
    Upward trending visuals, growth metaphors.
    Green and gold tones suggesting prosperity.
    Abstract representation of achievement.
    No text, no people.
    High quality, 4K resolution.`,

  aiTech: `Futuristic AI and technology background.
    Neural network patterns, circuit board aesthetics.
    Blue and purple gradients with glowing elements.
    Cutting-edge, innovative feel.
    Cyber punk style with neon accents.
    Modern UI elements floating in space.
    No text, no people.
    High quality, 4K resolution.`,

  business: `Money and business success background.
    Gold coins, cryptocurrency symbols, growth charts.
    Luxury feel with gold and black color scheme.
    Financial success, wealth creation metaphors.
    Modern fintech aesthetic.
    Glowing graphs trending upward.
    No text, no people.
    High quality, 4K resolution.`,

  education: `Inspiring education and parenting background.
    Warm, nurturing atmosphere with soft lighting.
    Books, graduation caps, lightbulbs (ideas).
    Orange and green color scheme suggesting growth.
    Family-friendly, trustworthy feel.
    Children's potential, future success imagery.
    No text, no people.
    High quality, 4K resolution.`,

  development: `Software development and coding background.
    Code editor aesthetics, terminal windows.
    Matrix-style code rain or floating code snippets.
    Dark theme with neon syntax highlighting colors.
    Modern IDE look, GitHub-style interfaces.
    No readable text, abstract code patterns only.
    High quality, 4K resolution.`,

  activity: `Energetic team activity background.
    Dynamic, movement-inspired abstract shapes.
    Bright, cheerful colors suggesting fun and energy.
    Gaming and esports aesthetic elements.
    Competition and achievement vibes.
    No text, no people.
    High quality, 4K resolution.`,
} as const;
