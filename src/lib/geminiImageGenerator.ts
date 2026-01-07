/**
 * Gemini 2.5 Flash Image API を使用した画像生成モジュール
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig, PATHS, IMAGE_SIZES, DEFAULT_PROMPTS } from './config.js';
import { logger } from './logger.js';
import type { GeminiImageResponse, ImageGenerationOptions } from './types.js';

export class GeminiImageGenerator {
  private genAI: GoogleGenerativeAI;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  constructor() {
    const config = getConfig();
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    // Gemini 2.0 Flash experimental with image generation
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        // @ts-expect-error - responseModalities is a valid config for image generation
        responseModalities: ['Text', 'Image'],
      },
    });
  }

  /**
   * プロンプトから画像を生成
   */
  async generateImage(options: ImageGenerationOptions): Promise<GeminiImageResponse> {
    const { width, height, prompt, style } = options;

    try {
      logger.info(`画像生成開始: ${width}x${height}`);
      logger.debug(`プロンプト: ${prompt}`);

      // プロンプトを構築
      const fullPrompt = `Generate an image with the following specifications:
- Size: ${width}x${height} pixels
- Style: ${style || 'modern, professional, clean'}
- Content: ${prompt}
- Important: No text in the image, suitable as background for overlaying text later.`;

      const response = await this.model.generateContent(fullPrompt);
      const result = response.response;

      // レスポンスから画像データを取得
      const candidates = result.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('画像生成に失敗しました: レスポンスが空です');
      }

      const parts = candidates[0].content?.parts;
      if (!parts) {
        throw new Error('画像生成に失敗しました: パーツが見つかりません');
      }

      // 画像データを探す
      for (const part of parts) {
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          const mimeType = part.inlineData.mimeType;
          const extension = mimeType.includes('png') ? 'png' : 'jpg';

          // 出力ディレクトリを確保
          await fs.mkdir(PATHS.generated, { recursive: true });

          // ファイル名を生成
          const filename = `gemini_${uuidv4()}.${extension}`;
          const outputPath = path.join(PATHS.generated, filename);

          // Base64データをバッファに変換して保存
          const buffer = Buffer.from(imageData, 'base64');
          await fs.writeFile(outputPath, buffer);

          logger.success(`画像生成完了: ${outputPath}`);
          return {
            success: true,
            imagePath: outputPath,
          };
        }
      }

      throw new Error('画像データが見つかりませんでした');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`画像生成エラー: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * カルーセル用背景画像を生成
   */
  async generateCarouselBackground(category: string): Promise<GeminiImageResponse> {
    // カテゴリに応じたプロンプトを選択
    let prompt = DEFAULT_PROMPTS.educational;

    if (category.includes('お知らせ') || category.includes('announcement')) {
      prompt = DEFAULT_PROMPTS.announcement;
    } else if (category.includes('成功') || category.includes('事例') || category.includes('success')) {
      prompt = DEFAULT_PROMPTS.successStory;
    } else if (category.includes('AI') || category.includes('テク') || category.includes('tech')) {
      prompt = DEFAULT_PROMPTS.aiTech;
    }

    return this.generateImage({
      width: IMAGE_SIZES.carousel.width,
      height: IMAGE_SIZES.carousel.height,
      prompt,
      style: 'modern, vibrant, professional',
    });
  }

  /**
   * リール用背景画像を生成
   */
  async generateReelBackground(category: string): Promise<GeminiImageResponse> {
    let prompt = DEFAULT_PROMPTS.educational;

    if (category.includes('お知らせ')) {
      prompt = DEFAULT_PROMPTS.announcement;
    } else if (category.includes('成功') || category.includes('事例')) {
      prompt = DEFAULT_PROMPTS.successStory;
    } else if (category.includes('AI') || category.includes('テク')) {
      prompt = DEFAULT_PROMPTS.aiTech;
    }

    return this.generateImage({
      width: IMAGE_SIZES.reel.width,
      height: IMAGE_SIZES.reel.height,
      prompt: prompt + '\nVertical orientation for mobile viewing.',
      style: 'dynamic, engaging, mobile-first',
    });
  }

  /**
   * 既存の写真を解析してスタイルに合った画像を生成
   */
  async generateFromReference(referencePath: string): Promise<GeminiImageResponse> {
    try {
      // 参照画像を読み込む
      const imageBuffer = await fs.readFile(referencePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = referencePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

      logger.info(`参照画像から新しい画像を生成: ${referencePath}`);

      const response = await this.model.generateContent([
        {
          inlineData: {
            mimeType,
            data: base64Image,
          },
        },
        `Based on this reference image, generate a similar styled background image suitable for Instagram.
         - Match the color scheme and mood
         - Create an abstract/geometric interpretation
         - No text, suitable as background for overlaying text
         - Professional, modern aesthetic
         - Size: 1080x1350 pixels`,
      ]);

      const result = response.response;
      const candidates = result.candidates;

      if (!candidates || candidates.length === 0) {
        throw new Error('参照画像からの生成に失敗しました');
      }

      const parts = candidates[0].content?.parts;
      if (!parts) {
        throw new Error('パーツが見つかりません');
      }

      for (const part of parts) {
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          const extension = part.inlineData.mimeType.includes('png') ? 'png' : 'jpg';

          await fs.mkdir(PATHS.generated, { recursive: true });
          const filename = `gemini_ref_${uuidv4()}.${extension}`;
          const outputPath = path.join(PATHS.generated, filename);

          const buffer = Buffer.from(imageData, 'base64');
          await fs.writeFile(outputPath, buffer);

          logger.success(`参照画像から生成完了: ${outputPath}`);
          return {
            success: true,
            imagePath: outputPath,
          };
        }
      }

      throw new Error('画像データが見つかりませんでした');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`参照画像からの生成エラー: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * raw_photos フォルダからランダムに画像を選択
   */
  async getRandomRawPhoto(): Promise<string | null> {
    try {
      const files = await fs.readdir(PATHS.rawPhotos);
      const imageFiles = files.filter((f) =>
        /\.(jpg|jpeg|png|webp)$/i.test(f)
      );

      if (imageFiles.length === 0) {
        return null;
      }

      const randomFile = imageFiles[Math.floor(Math.random() * imageFiles.length)];
      return path.join(PATHS.rawPhotos, randomFile);
    } catch {
      return null;
    }
  }

  /**
   * カルーセル投稿用の5枚の背景画像を生成
   */
  async generateCarouselBackgrounds(category: string): Promise<string[]> {
    const backgrounds: string[] = [];

    // まず既存の写真があるか確認
    const rawPhoto = await this.getRandomRawPhoto();

    for (let i = 0; i < 5; i++) {
      let result: GeminiImageResponse;

      // 表紙と最終ページは新規生成、中間ページは参照画像があれば使用
      if (rawPhoto && i > 0 && i < 4) {
        result = await this.generateFromReference(rawPhoto);
      } else {
        result = await this.generateCarouselBackground(category);
      }

      if (result.success && result.imagePath) {
        backgrounds.push(result.imagePath);
      } else {
        // フォールバック: デフォルト画像を使用またはエラー
        logger.warn(`背景画像 ${i + 1} の生成に失敗、再試行...`);
        const retryResult = await this.generateCarouselBackground(category);
        if (retryResult.success && retryResult.imagePath) {
          backgrounds.push(retryResult.imagePath);
        }
      }

      // レート制限対策
      await this.delay(1000);
    }

    return backgrounds;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const geminiGenerator = new GeminiImageGenerator();
