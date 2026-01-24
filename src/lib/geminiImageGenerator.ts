/**
 * Gemini 2.5 Flash Image API を使用した画像生成モジュール
 * カテゴリに応じた写真選択とImage-to-Image機能を提供
 * デザインルールに基づいて文字禁止を強制
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig, PATHS, IMAGE_SIZES, DEFAULT_PROMPTS } from './config.js';
import { logger } from './logger.js';
import { designRules } from './designRules.js';
import type { GeminiImageResponse, ImageGenerationOptions } from './types.js';

// 写真カテゴリのキーワードマッピング
const PHOTO_CATEGORY_KEYWORDS = {
  // お知らせ・告知系
  announcement: [
    '記念撮影', '記念写真', '集合写真', 'ピース', '笑顔',
    '立っている', 'イベント', '発表', '表彰'
  ],
  // 授業風景
  lesson: [
    '授業', '教室', 'PC作業', 'ノートPC', '座っている',
    '勉強', '学習', '操作', '作業'
  ],
  // 活動内容・イベント
  activity: [
    'イベント', '体験', 'ゲーム', '大会', 'e-sport', 'eスポーツ',
    'マイクラ', 'ストリートファイター', 'RPG', '発表会',
    'ワークスペース', 'コワーク'
  ],
  // 成功事例・実績
  success: [
    '景品', '受賞', '優勝', '表彰', '発表', '壇上',
    '紹介', 'プレゼン', '大会'
  ],
  // チーム・メンバー紹介
  team: [
    '集合写真', '並んで', 'メンバー', 'クラスメイト',
    '肩を組んで', 'if塾', '高崎', '山崎', '加賀屋', '井上'
  ],
  // 技術・テック系
  tech: [
    'PC', 'ノートPC', 'コンピューター', 'プログラミング',
    'ゲーム', 'コントローラー', 'e-sport', 'モニター'
  ],
};

export class GeminiImageGenerator {
  private genAI: GoogleGenerativeAI;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private imagenModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private cachedPhotos: Map<string, string[]> = new Map();

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
    // Imagen 3 for high-quality background generation (no text)
    this.imagenModel = this.genAI.getGenerativeModel({
      model: 'imagen-3.0-generate-002',
    });
  }

  /**
   * raw_photosフォルダの写真を読み込んでキャッシュ
   */
  async loadAndCachePhotos(): Promise<void> {
    try {
      const files = await fs.readdir(PATHS.rawPhotos);
      const imageFiles = files.filter((f) =>
        /\.(jpg|jpeg|png|webp|JPG|JPEG|PNG)$/i.test(f)
      );

      // カテゴリごとに写真を分類
      for (const category of Object.keys(PHOTO_CATEGORY_KEYWORDS)) {
        const keywords = PHOTO_CATEGORY_KEYWORDS[category as keyof typeof PHOTO_CATEGORY_KEYWORDS];
        const matchingPhotos = imageFiles.filter((filename) =>
          keywords.some((keyword) => filename.includes(keyword))
        );
        this.cachedPhotos.set(category, matchingPhotos);
        logger.debug(`カテゴリ "${category}": ${matchingPhotos.length} 枚の写真を分類`);
      }

      // 全ての写真も保存
      this.cachedPhotos.set('all', imageFiles);
      logger.info(`${imageFiles.length} 枚の写真をロードしました`);
    } catch (error) {
      logger.warn('写真のロードに失敗しました');
    }
  }

  /**
   * カテゴリに基づいて適切な写真を選択
   */
  async getPhotoByCategory(category: string): Promise<string | null> {
    // キャッシュがなければロード
    if (this.cachedPhotos.size === 0) {
      await this.loadAndCachePhotos();
    }

    // カテゴリを判定
    let targetCategory = 'all';

    const categoryLower = category.toLowerCase();
    if (categoryLower.includes('お知らせ') || categoryLower.includes('announcement') || categoryLower.includes('告知')) {
      targetCategory = 'announcement';
    } else if (categoryLower.includes('授業') || categoryLower.includes('lesson') || categoryLower.includes('学習')) {
      targetCategory = 'lesson';
    } else if (categoryLower.includes('活動') || categoryLower.includes('activity') || categoryLower.includes('イベント')) {
      targetCategory = 'activity';
    } else if (categoryLower.includes('成功') || categoryLower.includes('事例') || categoryLower.includes('success') || categoryLower.includes('実績')) {
      targetCategory = 'success';
    } else if (categoryLower.includes('チーム') || categoryLower.includes('team') || categoryLower.includes('メンバー')) {
      targetCategory = 'team';
    } else if (categoryLower.includes('ai') || categoryLower.includes('テク') || categoryLower.includes('tech') || categoryLower.includes('プログラミング')) {
      targetCategory = 'tech';
    }

    const photos = this.cachedPhotos.get(targetCategory) || this.cachedPhotos.get('all') || [];

    if (photos.length === 0) {
      logger.warn(`カテゴリ "${targetCategory}" の写真が見つかりません`);
      return null;
    }

    // ランダムに選択
    const randomPhoto = photos[Math.floor(Math.random() * photos.length)];
    const photoPath = path.join(PATHS.rawPhotos, randomPhoto);

    logger.info(`カテゴリ "${targetCategory}" から写真を選択: ${randomPhoto}`);
    return photoPath;
  }

  /**
   * プロンプトから画像を生成
   * デザインルールに基づいて文字禁止を強制
   */
  async generateImage(options: ImageGenerationOptions): Promise<GeminiImageResponse> {
    const { width, height, prompt, style } = options;

    try {
      logger.info(`画像生成開始: ${width}x${height}`);
      logger.debug(`プロンプト: ${prompt}`);

      // デザインルールから文字禁止のサフィックスを取得
      const noTextSuffix = await designRules.getImagePromptSuffix();

      // プロンプトを構築（文字禁止ルールを強制適用）
      const fullPrompt = `Generate an image with the following specifications:
- Size: ${width}x${height} pixels
- Style: ${style || 'modern, professional, clean'}
- Content: ${prompt}
- CRITICAL REQUIREMENT: No text, letters, numbers, signs, logos, watermarks, or any readable characters anywhere in the image. All surfaces must be clean without any writing.
${noTextSuffix}`;

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
    let prompt: string = DEFAULT_PROMPTS.educational;

    if (category.includes('お知らせ') || category.includes('announcement')) {
      prompt = DEFAULT_PROMPTS.announcement;
    } else if (category.includes('成功') || category.includes('事例') || category.includes('success')) {
      prompt = DEFAULT_PROMPTS.successStory;
    } else if (category.includes('AI') || category.includes('テク') || category.includes('tech') || category.includes('ai')) {
      prompt = DEFAULT_PROMPTS.aiTech;
    } else if (category.includes('business') || category.includes('ビジネス') || category.includes('稼')) {
      prompt = DEFAULT_PROMPTS.business;
    } else if (category.includes('education') || category.includes('教育')) {
      prompt = DEFAULT_PROMPTS.education;
    }

    return this.generateImage({
      width: IMAGE_SIZES.carousel.width,
      height: IMAGE_SIZES.carousel.height,
      prompt,
      style: 'modern, vibrant, professional, eye-catching gradients',
    });
  }

  /**
   * Imagen 3で背景画像を生成（テキストなし、HTML/CSSで後からテキスト合成用）
   * Genspark失敗時のフォールバックとして使用
   */
  async generateBackgroundWithImagen3(category: string): Promise<GeminiImageResponse> {
    // カテゴリ別の背景プロンプト（テキストは含まない）
    const categoryPrompts: Record<string, string> = {
      ai: 'Futuristic AI technology background, neural network patterns, glowing blue and purple neon gradients, cyberpunk aesthetic, holographic displays, digital particles, abstract tech visualization, dark background with bright accents, NO TEXT NO LETTERS NO WORDS',
      business: 'Luxury business success background, gold and black premium aesthetic, abstract wealth symbols, rising financial charts visualization, cryptocurrency inspired patterns, professional dark gradient, NO TEXT NO LETTERS NO WORDS',
      education: 'Warm educational learning background, inspiring classroom atmosphere, soft orange and green growth gradients, abstract knowledge visualization, lightbulb creativity patterns, welcoming academic aesthetic, NO TEXT NO LETTERS NO WORDS',
      development: 'Code editor inspired background, dark theme with neon syntax color accents, abstract programming visualization, matrix-style digital rain, software development aesthetic, terminal green highlights, NO TEXT NO LETTERS NO WORDS',
      activity: 'Energetic gaming and esports background, dynamic motion effects, bright cheerful neon colors, abstract competitive visualization, vibrant celebration aesthetic, exciting tournament atmosphere, NO TEXT NO LETTERS NO WORDS',
      announcement: 'Celebratory announcement background, confetti and sparkle effects, exciting warm gradient colors, festive celebration aesthetic, modern event poster style, dynamic energy visualization, NO TEXT NO LETTERS NO WORDS',
    };

    const prompt = categoryPrompts[category] || categoryPrompts.ai;

    const fullPrompt = `Generate a high-quality Instagram background image:
${prompt}

CRITICAL REQUIREMENTS:
- Aspect ratio: 4:5 (portrait, 1080x1350 pixels style)
- ABSOLUTELY NO TEXT, LETTERS, NUMBERS, WORDS, SIGNS, LOGOS, OR WATERMARKS
- Keep center area relatively simple for text overlay
- Vibrant, eye-catching colors
- Professional, modern aesthetic
- Suitable for social media marketing`;

    try {
      logger.info(`Imagen 3で背景画像を生成中... (カテゴリ: ${category})`);

      const response = await this.imagenModel.generateContent(fullPrompt);
      const result = response.response;

      const candidates = result.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Imagen 3: レスポンスが空です');
      }

      const parts = candidates[0].content?.parts;
      if (!parts) {
        throw new Error('Imagen 3: パーツが見つかりません');
      }

      // 画像データを探す
      for (const part of parts) {
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          const mimeType = part.inlineData.mimeType;
          const extension = mimeType.includes('png') ? 'png' : 'jpg';

          await fs.mkdir(PATHS.generated, { recursive: true });

          const filename = `imagen3_${category}_${uuidv4()}.${extension}`;
          const outputPath = path.join(PATHS.generated, filename);

          const buffer = Buffer.from(imageData, 'base64');
          await fs.writeFile(outputPath, buffer);

          logger.success(`Imagen 3背景画像生成完了: ${outputPath}`);
          return {
            success: true,
            imagePath: outputPath,
          };
        }
      }

      throw new Error('Imagen 3: 画像データが見つかりません');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`Imagen 3エラー: ${errorMessage}`);

      // Imagen 3が失敗した場合、従来のGemini 2.0 Flashにフォールバック
      logger.warn('Imagen 3失敗、Gemini 2.0 Flashにフォールバック...');
      return this.generateCarouselBackground(category);
    }
  }

  /**
   * 具体的なプロンプトから背景画像を生成（コンテンツ連動型）
   * デザインルールに基づいて文字禁止を強制
   */
  async generateContentSpecificBackground(
    customPrompt: string,
    size: 'carousel' | 'reel' = 'carousel'
  ): Promise<GeminiImageResponse> {
    const dimensions = size === 'carousel' ? IMAGE_SIZES.carousel : IMAGE_SIZES.reel;

    // デザインルールから文字禁止のサフィックスを取得
    const noTextSuffix = await designRules.getImagePromptSuffix();

    const enhancedPrompt = `${customPrompt}

Requirements:
- High quality, 4K resolution
- Modern, eye-catching design
- Suitable for text overlay (avoid busy center areas)
- ${size === 'reel' ? 'Vertical orientation, mobile-first design' : 'Portrait format'}
- Vibrant colors, professional look
- ABSOLUTELY NO TEXT, LETTERS, NUMBERS, SIGNS, LOGOS, OR WATERMARKS ANYWHERE IN THE IMAGE
${noTextSuffix}`;

    return this.generateImage({
      width: dimensions.width,
      height: dimensions.height,
      prompt: enhancedPrompt,
      style: 'modern, vibrant, Instagram-worthy, professional',
    });
  }

  /**
   * リール用背景画像を生成
   */
  async generateReelBackground(category: string): Promise<GeminiImageResponse> {
    let prompt: string = DEFAULT_PROMPTS.educational;

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
      style: 'dynamic, engaging, mobile-first, vibrant colors',
    });
  }

  /**
   * 既存の写真を元にImage-to-Imageで新しい背景画像を生成
   * 元の写真のスタイルを保ちつつ、テキストオーバーレイに適した画像を生成
   * デザインルールに基づいて文字禁止を強制
   */
  async generateFromReference(referencePath: string, category: string = ''): Promise<GeminiImageResponse> {
    try {
      // 参照画像を読み込む
      const imageBuffer = await fs.readFile(referencePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = referencePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

      logger.info(`参照画像から新しい画像を生成: ${path.basename(referencePath)}`);

      // デザインルールから文字禁止のサフィックスを取得
      const noTextSuffix = await designRules.getImagePromptSuffix();

      // カテゴリに応じた追加プロンプト
      let styleHint = 'professional, modern aesthetic';
      if (category.includes('お知らせ') || category.includes('告知') || category === 'announcement') {
        styleHint = 'celebratory, exciting, announcement style with warm colors';
      } else if (category.includes('授業') || category.includes('学習') || category === 'education') {
        styleHint = 'educational, studious atmosphere, calm and focused';
      } else if (category.includes('活動') || category.includes('イベント') || category === 'activity') {
        styleHint = 'dynamic, energetic, event atmosphere';
      } else if (category.includes('成功') || category.includes('実績') || category === 'business') {
        styleHint = 'achievement, success, uplifting atmosphere';
      }

      const response = await this.model.generateContent([
        {
          inlineData: {
            mimeType,
            data: base64Image,
          },
        },
        `Based on this reference image, create a stylized artistic background suitable for Instagram.

Key requirements:
- Transform the photo into an artistic, eye-catching background
- Apply vibrant gradient overlays and color effects
- Keep the essence and mood of the original photo
- Style: ${styleHint}
- Make it suitable for overlaying text (slightly blurred/abstract areas)
- Add dynamic elements like light rays, bokeh, or subtle patterns
- Size: 1080x1350 pixels (Instagram portrait format)
- Output should be visually striking and attention-grabbing

CRITICAL - ABSOLUTELY NO TEXT:
- NO text, letters, numbers, signs, or readable characters anywhere in the output image
- NO logos, watermarks, or brand names
- All surfaces (walls, signs, screens, clothing) must be clean without any writing
${noTextSuffix}`,
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
   * raw_photos フォルダからランダムに画像を選択（後方互換性用）
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
   * お知らせ、授業風景、活動内容の場合は元写真からImage-to-Imageで生成
   */
  async generateCarouselBackgrounds(category: string): Promise<string[]> {
    const backgrounds: string[] = [];

    // カテゴリに応じた写真を取得
    const shouldUseRawPhoto = this.shouldUseRawPhotos(category);
    let selectedPhotos: string[] = [];

    if (shouldUseRawPhoto) {
      // 複数の写真を選択（重複を避ける）
      await this.loadAndCachePhotos();
      const usedPhotos = new Set<string>();

      for (let i = 0; i < 5; i++) {
        const photo = await this.getPhotoByCategory(category);
        if (photo && !usedPhotos.has(photo)) {
          selectedPhotos.push(photo);
          usedPhotos.add(photo);
        }
      }
      logger.info(`カテゴリ "${category}" 用に ${selectedPhotos.length} 枚の写真を選択`);
    }

    for (let i = 0; i < 5; i++) {
      let result: GeminiImageResponse;

      // 元写真がある場合はImage-to-Imageを使用
      if (shouldUseRawPhoto && selectedPhotos.length > 0) {
        const photoIndex = i % selectedPhotos.length;
        const rawPhoto = selectedPhotos[photoIndex];

        logger.info(`スライド ${i + 1}: 元写真からImage-to-Image生成`);
        result = await this.generateFromReference(rawPhoto, category);

        // 失敗した場合はフォールバック
        if (!result.success) {
          logger.warn(`Image-to-Image失敗、通常の生成にフォールバック`);
          result = await this.generateCarouselBackground(category);
        }
      } else {
        // 通常の画像生成
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
      await this.delay(1500);
    }

    return backgrounds;
  }

  /**
   * カテゴリに基づいて元写真を使用すべきか判定
   */
  private shouldUseRawPhotos(category: string): boolean {
    const categoryLower = category.toLowerCase();
    const useRawPhotoCategories = [
      'お知らせ', 'announcement', '告知',
      '授業', 'lesson', '学習',
      '活動', 'activity', 'イベント',
      '成功', 'success', '実績', '事例',
      'チーム', 'team', 'メンバー',
    ];

    return useRawPhotoCategories.some((keyword) =>
      categoryLower.includes(keyword.toLowerCase())
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const geminiGenerator = new GeminiImageGenerator();
