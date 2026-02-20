/**
 * NanoBanaPro画像生成モジュール
 * Gemini API（gemini-2.5-flash）を使用してInstagram用画像を生成
 * YouTubeサムネと同じスタイル: 翔太キャラ + 装飾テキスト + テーマ背景
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { getConfig, PATHS, PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';
import type { CategoryType, Slide, GeminiImageResponse } from './types.js';

// キャラクター参照画像パス
const CHARACTER_IMAGE_PATH = path.join(PROJECT_ROOT, 'assets', 'character', '翔太アバター.jpg');

// キャラクター設定
const SHOTA_CHARACTER_DESCRIPTION = `
Character "翔太" (Shota):
- Black headband completely covering/hiding eyes (like a blindfold - eyes are NEVER visible)
- Messy, spiky black hair with glossy highlights
- Black T-shirt with light blue shoulder accents
- Black wide half-pants
- Red-brown wooden geta sandals
- Cyan/light-blue cyberpunk circuit tattoo patterns on both arms
- Often holding a gray laptop in one hand
- Chibi/super-deformed anime style
- Always smiling with mouth open
`;

// カテゴリ別テーマ（日本語）
const CATEGORY_THEMES: Record<CategoryType, string> = {
  ai: 'AI・テクノロジー（青と紫のネオングラデーション、未来的サイバー空間）',
  business: 'ビジネス・成功（ゴールドと黒、上昇グラフ、プロフェッショナル）',
  education: '教育・学習（暖かいオレンジと緑、本と電球、成長イメージ）',
  development: 'プログラミング・開発（ダークテーマ、ネオンコード、ターミナル風）',
  activity: 'アクティビティ・楽しさ（明るくカラフル、ゲーミング風）',
  announcement: 'お知らせ・イベント（祝祭感、紙吹雪、明るい色彩）',
};

// リアクションポーズのバリエーション
const REACTION_POSES = [
  'pointing excitedly at the topic with one hand, laptop in the other, leaning forward with energy',
  'both fists pumped up in excitement, laptop tucked under arm, jumping slightly',
  'giving enthusiastic thumbs up with a huge grin, other hand on laptop',
  'arms spread wide in amazement, laptop balanced on one hand, mouth wide open in awe',
  'pointing upward at the text dramatically, other hand holding laptop, dynamic action pose',
  'cross-armed with confident stance, laptop visible, nodding approvingly',
  'running forward energetically holding laptop, as if rushing to share exciting news',
  'holding laptop screen toward viewer excitedly, other hand making peace sign',
];

export class NanoBananaProGenerator {
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const config = getConfig();
      this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    return this.client;
  }

  /**
   * キャラクター参照画像を読み込む
   */
  private async loadCharacterImage(): Promise<{ data: string; mimeType: string } | null> {
    try {
      const imageBuffer = await fs.readFile(CHARACTER_IMAGE_PATH);
      const base64 = imageBuffer.toString('base64');
      return { data: base64, mimeType: 'image/jpeg' };
    } catch (error) {
      logger.warn(`キャラクター参照画像が見つかりません: ${CHARACTER_IMAGE_PATH}`);
      return null;
    }
  }

  /**
   * スライド用の画像生成プロンプトを作成
   */
  private buildPrompt(
    slide: Slide,
    slideIndex: number,
    totalSlides: number,
    category: CategoryType,
    title: string
  ): string {
    const theme = CATEGORY_THEMES[category] || CATEGORY_THEMES.ai;
    const pose = REACTION_POSES[slideIndex % REACTION_POSES.length];
    const isCover = slide.type === 'cover';

    // テキスト内容を準備（8文字以内のメインキーワード）
    let mainText: string;
    let subTexts: string[] = [];

    if (isCover) {
      const words = slide.headline.split(/[：:・\s]+/).filter(w => w.length > 0);
      mainText = (words[0] || slide.headline).slice(0, 10);
      subTexts = words.slice(1, 3).map(w => w.slice(0, 14));
    } else {
      mainText = slide.headline.slice(0, 10);
      subTexts = slide.points?.slice(0, 2).map(p => p.slice(0, 14)) || [];
    }

    return `Generate a square Instagram post image (1080x1080 pixels, 1:1 aspect ratio).

TITLE: ${title}
SLIDE ${slideIndex + 1}/${totalSlides}: ${slide.headline}

== CHARACTER (MOST IMPORTANT - use the attached reference image) ==
${SHOTA_CHARACTER_DESCRIPTION}
- Character should be ${pose}
- Take up about 35-40% of the image, positioned on the right or bottom-right
- MUST keep the black headband hiding eyes exactly as in reference
- Dynamic, energetic pose matching the topic

== JAPANESE TEXT (LARGE, DECORATED, MUST BE READABLE) ==
- Main text at top: 「${mainText}」 in HUGE bold decorated font
  * Thick black outline (4px+), drop shadow, glow effect
  * Yellow or white text on high-contrast background
  * Text MUST be fully visible (no cut-off at edges)
${subTexts.length > 0 ? `- Sub text at bottom: 「${subTexts.join('」「')}」 in smaller decorated font
  * Also with outline and shadow effects` : ''}
- Add decorative elements: stars ★, arrows →, emphasis marks, speech bubbles
- Text should feel like it's SHOUTING — high energy, maximum impact
- ONLY Japanese text, NO English

== BACKGROUND ==
- Theme: ${theme}
- Vibrant, eye-catching, high contrast
- Related to the topic: ${slide.headline}
- Subtle tech/topic icons or patterns OK

== STYLE ==
- Must look like a TOP Japanese YouTube thumbnail / Instagram post
- Maximum visual impact — viewers MUST want to click
- Professional but energetic, bold colors
- Reference style: popular Japanese tech education YouTubers
- Square format (1:1) for Instagram

== FORBIDDEN ==
- No English text
- No bland/boring corporate look
- No static standing pose (must be dynamic)
- No text cut off at edges
- No UI buttons or interface elements

Generate ONLY the image. No text response needed.`;
  }

  /**
   * 単一画像を生成
   */
  async generateImage(
    slide: Slide,
    slideIndex: number,
    totalSlides: number,
    category: CategoryType,
    title: string
  ): Promise<GeminiImageResponse> {
    try {
      const client = this.getClient();
      const prompt = this.buildPrompt(slide, slideIndex, totalSlides, category, title);

      // キャラクター参照画像を読み込み
      const characterImage = await this.loadCharacterImage();

      // コンテンツを構築
      const contents: any[] = [];
      contents.push(prompt);

      if (characterImage) {
        contents.push('【参照キャラクター画像】このキャラクターを使用してください（目はヘアバンドで完全に隠れている点を厳守）:');
        contents.push({
          inlineData: {
            data: characterImage.data,
            mimeType: characterImage.mimeType,
          },
        });
      }

      logger.info(`Gemini画像生成中 (スライド ${slideIndex + 1}/${totalSlides})...`);

      // Gemini API呼び出し
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash-preview-05-20',
        contents: [{ role: 'user', parts: contents.map(c => {
          if (typeof c === 'string') return { text: c };
          return c;
        }) }],
        config: {
          responseModalities: ['image', 'text'],
          temperature: 1.0,
        },
      });

      // レスポンスから画像を抽出
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            const imageBuffer = Buffer.from(part.inlineData.data, 'base64');

            // 1080x1080にリサイズ
            const resizedBuffer = await sharp(imageBuffer)
              .resize(1080, 1080, { fit: 'cover' })
              .jpeg({ quality: 95 })
              .toBuffer();

            // ファイルに保存
            const filename = `nanobana_slide_${slideIndex + 1}_${Date.now()}.jpg`;
            const outputPath = path.join(PATHS.generated, filename);
            await fs.mkdir(PATHS.generated, { recursive: true });
            await fs.writeFile(outputPath, resizedBuffer);

            logger.success(`画像生成完了: ${outputPath}`);
            return { success: true, imagePath: outputPath };
          }
        }
      }

      return { success: false, error: '画像がレスポンスに含まれていません' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`NanoBanaPro画像生成エラー: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * カルーセル用4枚の画像を生成
   */
  async generateCarouselImages(
    slides: Slide[],
    category: CategoryType,
    title: string
  ): Promise<string[]> {
    const images: string[] = [];

    for (let i = 0; i < Math.min(slides.length, 4); i++) {
      logger.info(`画像 ${i + 1}/${Math.min(slides.length, 4)} を生成中...`);

      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await this.generateImage(slides[i], i, slides.length, category, title);

        if (result.success && result.imagePath) {
          images.push(result.imagePath);
          success = true;
          break;
        }

        logger.warn(`画像 ${i + 1} 生成失敗 (試行 ${attempt}/3): ${result.error}`);
        // レート制限対策
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      if (!success) {
        logger.error(`画像 ${i + 1} の生成に3回失敗しました`);
      }

      // API レート制限対策
      if (i < slides.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return images;
  }
}

export const nanobananaProGenerator = new NanoBananaProGenerator();
