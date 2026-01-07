/**
 * if-juku Instagram Automation - 型定義
 */

// スライドタイプ
export type SlideType = 'cover' | 'content' | 'thanks';

// スライド定義
export interface Slide {
  type: SlideType;
  headline: string;
  subtext?: string;
  points?: string[];
  cta?: string;
}

// トピック定義
export interface Topic {
  id: string;
  category: string;
  title: string;
  slides: Slide[];
  caption: string;
}

// トピックデータ全体
export interface TopicsData {
  topics: Topic[];
  settings: {
    rotationMode: 'sequential' | 'random';
    lastUsedIndex: number;
  };
}

// 画像生成オプション
export interface ImageGenerationOptions {
  width: number;
  height: number;
  prompt: string;
  style?: string;
}

// カルーセル画像生成結果
export interface CarouselGenerationResult {
  topicId: string;
  images: string[];  // ファイルパスの配列
  caption: string;
  generatedAt: Date;
}

// リール生成結果
export interface ReelGenerationResult {
  topicId: string;
  videoPath: string;
  caption: string;
  generatedAt: Date;
}

// Instagram投稿結果
export interface InstagramPostResult {
  success: boolean;
  postId?: string;
  error?: string;
  postedAt: Date;
}

// 画像合成オプション
export interface CompositeOptions {
  templatePath: string;
  backgroundImagePath: string;
  outputPath: string;
  variables: Record<string, string>;
}

// Gemini APIレスポンス（画像生成用）
export interface GeminiImageResponse {
  success: boolean;
  imagePath?: string;
  error?: string;
}

// ワークフロー設定
export interface WorkflowConfig {
  contentType: 'carousel' | 'reel';
  scheduleTime: '09:00' | '20:00';
  topicSelectionMode: 'sequential' | 'random';
}

// ログレベル
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// 設定
export interface AppConfig {
  geminiApiKey: string;
  instagramAccountId: string;
  instagramAccessToken: string;
  outputDir: string;
  logLevel: LogLevel;
}
