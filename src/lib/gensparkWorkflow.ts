/**
 * Genspark統合ワークフロー
 * コンテンツ企画 → Genspark画像生成 → FTPアップロード → Instagram投稿準備
 */
import path from 'path';
import fs from 'fs/promises';
import { gensparkPlaywright } from './gensparkPlaywright.js';
import { ftpUploader } from './ftpUploader.js';
import { htmlComposer } from './htmlComposer.js';
import { contentGenerator } from './contentGenerator.js';
import { logger } from './logger.js';
import { PATHS } from './config.js';
import { designRules } from './designRules.js';
import type { CategoryType, Slide, CarouselGenerationResult } from './types.js';
import {
  getAllCharacters,
  type Character,
  type CharacterRole,
} from './characterManager.js';
import { characterCompositor } from './characterCompositor.js';
import { blogGenerator, NewsInfo, BlogArticle } from './blogGenerator.js';
import { postHistory } from './postHistory.js';
import {
  imageQualityEvaluator,
  type QualityCheckResult,
  type CharacterFeatures,
  type EvaluationRequest,
} from './imageQualityEvaluator.js';
import { failsafeImageProcessor } from './failsafeImageProcessor.js';
import { publerApi } from './publerApi.js';
// 必須モジュール: 毎回の投稿生成時に必ず使用
import { notebookLmClient, BusinessInfo } from './notebookLmClient.js';
import { newsResearcher } from './newsResearcher.js';
// Geminiフォールバック用
import { geminiGenerator } from './geminiImageGenerator.js';

// 画像プロンプト生成用のカテゴリ別スタイル
const CATEGORY_STYLES: Record<CategoryType, string> = {
  ai: 'Futuristic AI technology, neural networks, glowing blue and purple gradients, cyberpunk aesthetic, holographic displays',
  business: 'Success and wealth, gold and black luxury, rising graphs, cryptocurrency, professional business aesthetic',
  education: 'Warm educational atmosphere, learning environment, books and lightbulbs, orange and green growth colors',
  development: 'Code editor aesthetics, dark theme with neon syntax colors, software development environment',
  activity: 'Energetic team activities, gaming and esports, dynamic movement, bright cheerful colors',
  announcement: 'Celebratory announcement, confetti and sparkles, exciting warm colors, modern event poster',
};

// Instagram用の画像要件（テキスト含む版）
const INSTAGRAM_IMAGE_WITH_TEXT_REQUIREMENTS = `
Requirements for Instagram:
- Aspect ratio: 4:5 (1080x1350 pixels)
- Modern, eye-catching design
- Include the specified Japanese text clearly and readably
- Text should be large, bold, and easy to read
- Vibrant colors, professional look
- High quality, 4K resolution
`;

// Instagram用の画像要件（背景のみ）
const INSTAGRAM_IMAGE_REQUIREMENTS = `
Requirements for Instagram:
- Aspect ratio: 4:5 (1080x1350 pixels)
- Modern, eye-catching design
- Suitable for text overlay (avoid busy center areas)
- Vibrant colors, professional look
- NO TEXT, LETTERS, NUMBERS, SIGNS, LOGOS, OR WATERMARKS
- High quality, 4K resolution
`;

export interface GensparkWorkflowOptions {
  category?: CategoryType;
  customTopic?: string;
  headless?: boolean; // ブラウザ表示するかどうか
  skipUpload?: boolean; // FTPアップロードをスキップ
  useCharacters?: boolean; // キャラクターを使用するかどうか
  directTextRendering?: boolean; // NanoBananaProで直接テキストを描画
  // 廃止予定: 以下のオプションは無視される（常にブログ先行型で実行）
  newsInfo?: NewsInfo; // 外部からのニュース情報（省略時は自動リサーチ）
  useBlogFirst?: boolean; // 常にtrue扱い
  skipNotebookLm?: boolean; // デバッグ用: NotebookLMをスキップ
  skipNewsResearch?: boolean; // デバッグ用: ニュースリサーチをスキップ
}

export interface GensparkWorkflowResult {
  success: boolean;
  topicId: string;
  title: string;
  slides: Slide[];
  localImages: string[]; // ローカルの最終画像パス
  publicUrls: string[]; // FTPアップロード後の公開URL
  caption: string;
  error?: string;
}

export class GensparkWorkflow {
  /**
   * 4枚のスライド用画像プロンプトを生成（背景のみ、テキストなし）
   */
  async generateImagePrompts(
    category: CategoryType,
    slides: Slide[],
    title: string
  ): Promise<string[]> {
    const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.ai;
    const noTextSuffix = await designRules.getImagePromptSuffix();

    const prompts: string[] = [];

    // 表紙用プロンプト（スライド1）
    const coverSlide = slides.find((s) => s.type === 'cover') || slides[0];
    prompts.push(`
Create a stunning cover image for Instagram post about "${title}".
Theme: ${coverSlide.headline}
Style: ${style}
${INSTAGRAM_IMAGE_REQUIREMENTS}
${noTextSuffix}
    `.trim());

    // 内容スライド用プロンプト（スライド2-4）
    const contentSlides = slides.filter((s) => s.type === 'content').slice(0, 3);
    for (let i = 0; i < contentSlides.length; i++) {
      const slide = contentSlides[i];
      prompts.push(`
Create a background image for content slide about "${slide.headline}".
Key points: ${slide.points?.slice(0, 2).join(', ') || ''}
Style: ${style}
${INSTAGRAM_IMAGE_REQUIREMENTS}
This image should visually represent the concept and be suitable for text overlay.
${noTextSuffix}
      `.trim());
    }

    // 足りない分を補完
    while (prompts.length < 4) {
      prompts.push(`
Create a professional background image for ${category} content.
Style: ${style}
${INSTAGRAM_IMAGE_REQUIREMENTS}
${noTextSuffix}
      `.trim());
    }

    return prompts;
  }

  /**
   * NanoBananaPro用の完全画像生成プロンプトを生成
   * キャラクター参照画像を使って、キャラクター・テキスト・背景を一体化した画像を生成
   */
  async generateNanoBananaProPrompts(
    category: CategoryType,
    slides: Slide[],
    title: string,
    characters?: Map<CharacterRole, Character>
  ): Promise<{ prompts: string[], referenceImages: string[] }> {
    const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.ai;
    const prompts: string[] = [];
    const referenceImages: string[] = [];

    // キャラクター情報を取得
    const jukucho = characters?.get('塾長');
    const jukuto = characters?.get('塾頭');

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const isCover = slide.type === 'cover';

      // スライドごとにキャラクターを選択（交互）
      const useJukucho = i % 2 === 0;
      const character = useJukucho ? jukucho : jukuto;
      const characterName = useJukucho ? '塾長' : '塾頭';

      // 参照画像は使用しない（テキストプロンプトのみで生成）
      // 注: 参照画像をアップロードすると元画像がそのまま出力される問題があるため無効化
      referenceImages.push('');

      // テキスト内容を準備
      let textContent: string;
      if (isCover) {
        textContent = slide.headline;
      } else {
        const points = slide.points?.map(p => `・${p}`).join('\n') || '';
        textContent = `${slide.headline}\n\n${points}`;
      }

      // キャラクターの説明（参照画像がある場合）
      const characterInstruction = character
        ? `このキャラクターを使って画像を作成してください。キャラクターは画像内で自然に配置し、内容を説明しているようなポーズにしてください。`
        : '';

      // キャラクターの詳細な説明をプロンプトに含める（参照画像に忠実に）
      const characterDescription = character
        ? (character.name === '塾長'
          ? 'セミリアルなアニメ調の18歳日本人男子大学生。くしゃっとした癖毛の黒髪（整った髪ではなく少し乱れた自然な癖毛）。若々しい丸みのある顔立ち。細めの優しい目。白いポロシャツ（襟付き、ボタン2-3個）。グレーのウィンドウペンチェック柄パンツ。爽やかで親しみやすい雰囲気。若い大学生らしいフレッシュな印象。おじさんや中年男性ではなく若者として描くこと。'
          : 'ちびキャラスタイル。ボサボサで尖った黒髪（光沢ハイライト付き）。黒い幅広ヘアバンドが目を常に完全に覆い隠す（目隠しのように、目は絶対に見えない）。笑顔で口を開ける。黒Tシャツ（肩に水色パーツ）。黒いワイドハーフパンツ。赤茶色の下駄。両腕に水色のサイバーパンク回路模様。グレーのノートPCを片手で持つ。')
        : '';

      // テキストを短いキーワードに分割してインパクトを出す
      let mainKeyword: string;
      let subKeywords: string[] = [];
      if (isCover) {
        // カバーは短いキャッチコピーに
        const words = slide.headline.split(/[：:・\s]+/).filter(w => w.length > 0);
        mainKeyword = words[0] || slide.headline.slice(0, 10);
        subKeywords = words.slice(1, 3);
      } else {
        // 内容スライドはヘッドラインをメインに
        mainKeyword = slide.headline.slice(0, 12);
        subKeywords = slide.points?.slice(0, 2).map(p => p.slice(0, 10)) || [];
      }

      // テーマに関連したアクションポーズを生成
      const actionPose = this.getActionPoseForTheme(mainKeyword, character?.name || '');

      // キャラクター中心のイラストプロンプト（アクションポーズ付き）
      prompts.push(`縦長イラストを生成。

【必須要素1: キャラクター（アクション中）】
${characterDescription}
※キャラクターはただ立っているのではなく、${actionPose}
※キャラクターを画像中央に配置

【必須要素2: 日本語テキスト（見切れ厳禁）】
画像上部に「${mainKeyword}」を大きく太字で表示すること
${subKeywords.length > 0 ? `画像下部に「${subKeywords.join('」「')}」を小さく表示` : ''}
※テキストは必ず画像内に完全に収めること（1文字も見切れ禁止）
※8文字以上のテキストは必ず改行して2行に分けること
※テキストは画像中央寄りに配置し、左右に十分な余白を確保すること
※日本語のみ、英語禁止

【デザイン】
- キャラクターがテーマに関連した作業をしている様子
- 文字に影やグロー効果で装飾
- 背景：${this.getCategoryThemeJa(category)}

【禁止】
- 直立不動で突っ立っているだけの画像禁止
- テキストなしの画像禁止
- テキストが画像端で見切れている画像禁止（例:「スタンプ」が「スタ」になる等）
- 英語禁止
- ボタンUI禁止

アスペクト比4:5。`);
    }

    return { prompts, referenceImages };
  }

  /**
   * カテゴリのテーマを日本語で取得
   */
  private getCategoryThemeJa(category: CategoryType): string {
    const themes: Record<CategoryType, string> = {
      ai: 'AI・テクノロジー（青と紫のグラデーション、未来的なデザイン）',
      business: 'ビジネス・成功（ゴールドと黒、プロフェッショナル）',
      education: '教育・学習（暖かいオレンジと緑、成長をイメージ）',
      development: 'プログラミング・開発（ダークテーマ、コードエディタ風）',
      activity: 'アクティビティ・楽しさ（明るくカラフル）',
      announcement: 'お知らせ・イベント（祝祭感、明るい色）',
    };
    return themes[category] || themes.ai;
  }

  /**
   * テーマに関連したアクションポーズを生成
   */
  private getActionPoseForTheme(theme: string, characterName: string): string {
    // キーワードに基づいてアクションを決定
    const keywords = theme.toLowerCase();

    // 塾頭（ちびキャラ）用のアクション
    if (characterName === '塾頭') {
      if (keywords.includes('分析') || keywords.includes('データ')) {
        return 'ノートPCの画面を指差しながらデータを分析している様子';
      }
      if (keywords.includes('効率') || keywords.includes('最適化')) {
        return 'ホログラフィックな画面を操作しながら効率化を実行している様子';
      }
      if (keywords.includes('予測') || keywords.includes('予想')) {
        return 'タブレットでグラフを見ながら未来を予測している様子';
      }
      if (keywords.includes('サプライ') || keywords.includes('物流')) {
        return '物流ネットワークの3Dマップを操作している様子';
      }
      if (keywords.includes('顧客') || keywords.includes('サポート')) {
        return 'チャット画面で顧客対応をしている様子';
      }
      if (keywords.includes('リスク')) {
        return '警告アイコンを確認しながらリスクをチェックしている様子';
      }
      // デフォルト
      return 'ノートPCを操作しながら作業に集中している様子';
    }

    // 塾長用のアクション
    if (keywords.includes('分析') || keywords.includes('データ')) {
      return 'ホログラフィックなデータグラフを指差しながら説明している様子';
    }
    if (keywords.includes('効率') || keywords.includes('最適化')) {
      return 'フローチャートやダイアグラムを指し示しながらプレゼンしている様子';
    }
    if (keywords.includes('予測') || keywords.includes('予想')) {
      return '未来を示す上向きのグラフを指差しながら解説している様子';
    }
    if (keywords.includes('サプライ') || keywords.includes('物流')) {
      return 'サプライチェーンの流れを示す図を操作している様子';
    }
    if (keywords.includes('顧客') || keywords.includes('サポート')) {
      return '顧客との会話シーンを示しながら説明している様子';
    }
    if (keywords.includes('リスク')) {
      return 'リスク評価チャートを指差しながら分析している様子';
    }
    // デフォルト
    return 'ホログラフィックな画面を操作しながら説明している様子';
  }

  /**
   * 品質チェック付きで単一画像を生成（自動リトライ機能付き）
   * 最大5回リトライし、Gensparkが完全失敗した場合はGeminiにフォールバック
   */
  async generateImageWithQualityCheck(
    prompt: string,
    slideIndex: number,
    slide: Slide,
    category: CategoryType,
    character: Character | undefined,
    referenceImage?: string
  ): Promise<{ imagePath: string; qualityResult: QualityCheckResult | null }> {
    const MAX_RETRIES = 5;
    let currentPrompt = prompt;
    let lastQualityResult: QualityCheckResult | null = null;
    let gensparkFatalError = false;

    // キャラクター特徴を定義
    const characterFeatures: CharacterFeatures = character
      ? {
          name: character.name,
          description: character.description?.ja || '',
          requiredElements: character.name === '塾長'
            ? ['くしゃっとした癖毛の黒髪', '若々しい丸みのある顔', '細めの目', '白いポロシャツ', 'グレーのチェック柄パンツ', '18歳の大学生らしい若さ']
            : ['ボサボサの黒髪', '目を覆うヘアバンド', '黒Tシャツ', 'ノートPC', 'サイバーパンク回路タトゥー'],
        }
      : {
          name: 'キャラクター',
          description: 'イラストキャラクター',
          requiredElements: [],
        };

    // 期待するテキストを抽出
    const expectedText: string[] = [];
    if (slide.headline) {
      expectedText.push(slide.headline.slice(0, 12));
    }
    if (slide.points) {
      expectedText.push(...slide.points.slice(0, 2).map(p => p.slice(0, 10)));
    }

    // ========================================
    // Phase 1: Gensparkで画像生成を試行（優先）
    // ========================================
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      logger.info(`画像 ${slideIndex + 1} 生成 [Genspark]: 試行 ${attempt}/${MAX_RETRIES}`);

      let images: string[] = [];
      try {
        // 画像生成
        images = await gensparkPlaywright.generateCarouselImages(
          [currentPrompt],
          category,
          referenceImage ? [referenceImage] : undefined
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // ログイン失敗などの致命的エラーはGensparkを諦めてGeminiへ
        if (errorMsg.includes('ログイン') || errorMsg.includes('login') || errorMsg.includes('認証')) {
          logger.error(`Genspark致命的エラー: ${errorMsg}`);
          gensparkFatalError = true;
          break;
        }
        logger.warn(`Genspark画像生成エラー（試行 ${attempt}）: ${errorMsg}`);
        continue;
      }

      if (images.length === 0) {
        logger.warn(`画像 ${slideIndex + 1} 生成失敗（試行 ${attempt}）`);
        continue;
      }

      const imagePath = images[0];

      // 品質チェック
      const evaluationRequest: EvaluationRequest = {
        imagePath,
        expectedCharacter: characterFeatures,
        expectedText,
        expectedBackground: this.getCategoryThemeJa(category),
        slideType: slide.type === 'cover' ? 'cover' : 'content',
      };

      const qualityResult = await imageQualityEvaluator.evaluateImage(evaluationRequest);
      lastQualityResult = qualityResult;

      logger.info(`品質スコア: ${qualityResult.score}/100`);

      // 品質チェック結果をログ
      const checkResults = qualityResult.checks;
      logger.info(`  - キャラクター存在: ${checkResults.characterPresent ? '✓' : '✗'}`);
      logger.info(`  - キャラクター特徴: ${checkResults.characterFeatures ? '✓' : '✗'}`);
      logger.info(`  - 背景: ${checkResults.backgroundValid ? '✓' : '✗ (背景が不適切)'}`);
      logger.info(`  - テキスト存在: ${checkResults.textPresent ? '✓' : '✗ (テキストなし)'}`);
      logger.info(`  - テキスト可読性: ${checkResults.textReadable ? '✓' : '✗'}`);
      logger.info(`  - テキスト完全性: ${checkResults.textComplete ? '✓' : '✗ (テキスト見切れ)'}`);
      logger.info(`  - 構図: ${checkResults.compositionValid ? '✓' : '✗'}`);

      // 必須チェック項目（厳格チェック: テキスト・キャラクター）
      // 背景は高スコアの場合は許容（リトライで品質が低下するリスクを避けるため）
      const strictChecks = {
        textPresent: checkResults.textPresent,
        textComplete: checkResults.textComplete,
        characterPresent: checkResults.characterPresent,
        characterFeatures: checkResults.characterFeatures,
      };

      const strictFailures: string[] = [];
      if (!strictChecks.textPresent) strictFailures.push('テキスト欠落');
      if (!strictChecks.textComplete) strictFailures.push('テキスト見切れ');
      if (!strictChecks.characterPresent) strictFailures.push('キャラクター欠落');
      if (!strictChecks.characterFeatures) strictFailures.push('キャラクター特徴不一致');

      // 背景のみ失敗で高スコア（>=65）の場合は許容
      // リトライで品質が低下するリスクを避ける
      const onlyBackgroundFailed = strictFailures.length === 0 && !checkResults.backgroundValid;
      if (onlyBackgroundFailed && qualityResult.score >= 65) {
        logger.warn(`⚠️ 背景のみ不合格だがスコア${qualityResult.score}で許容`);
        logger.success(`画像 ${slideIndex + 1} 品質チェック条件付き合格（スコア: ${qualityResult.score}）`);
        return { imagePath, qualityResult };
      }

      // 厳格チェック項目が失敗している場合
      const criticalFailures = [...strictFailures];
      if (!checkResults.backgroundValid) criticalFailures.push('背景欠落');

      if (criticalFailures.length > 0) {
        logger.error(`❌ 不合格: ${criticalFailures.join('、')}`);
        // スコアに関係なくリトライ必須
        if (attempt < MAX_RETRIES) {
          // 注意: オリジナルプロンプトをベースに修正（積み重ねない）
          currentPrompt = imageQualityEvaluator.generateFixedPrompt(
            prompt, // 常にオリジナルを使用
            qualityResult,
            characterFeatures
          );
          logger.info('プロンプトを修正してリトライ...');
          continue; // 次の試行へ
        }
        // 最終試行でも失敗した場合はフェイルセーフへ
        break;
      }

      // 必須項目がすべてOKの場合のみ合格
      logger.success(`画像 ${slideIndex + 1} 品質チェック合格（スコア: ${qualityResult.score}）`);
      return { imagePath, qualityResult };

    }

    // ========================================
    // Phase 2: Gemini フォールバック
    // Gensparkが完全に失敗した場合のみ実行
    // テキストなしの背景画像を生成し、後でhtmlComposerでテキスト合成
    // ========================================
    if (gensparkFatalError) {
      logger.warn('=== Gemini フォールバックを開始 ===');
      logger.warn('Gensparkログイン失敗のため、Geminiで背景画像を生成します');
      logger.info('テキストはhtmlComposerで後から合成します');

      // Geminiで背景画像生成を試行
      for (let geminiAttempt = 1; geminiAttempt <= 3; geminiAttempt++) {
        logger.info(`画像 ${slideIndex + 1} 生成 [Gemini]: 試行 ${geminiAttempt}/3`);

        try {
          // Geminiでカテゴリに応じた背景画像を生成（テキストなし）
          const result = await geminiGenerator.generateBackgroundWithImagen3(category);

          if (result.success && result.imagePath) {
            logger.success(`Gemini背景画像生成成功: ${result.imagePath}`);
            // needsTextOverlay: true を示すため、qualityResultをnullで返す
            // 呼び出し元でqualityResult===nullの場合はテキスト合成が必要と判断
            return { imagePath: result.imagePath, qualityResult: null };
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.warn(`Gemini画像生成エラー（試行 ${geminiAttempt}）: ${errorMsg}`);
        }
      }

      // Geminiも失敗した場合
      throw new Error(
        `画像 ${slideIndex + 1} の生成に完全に失敗しました。` +
        `Genspark（ログイン失敗）とGemini（3回試行）の両方が失敗しました。` +
        `投稿は中止されます。`
      );
    }

    // Gensparkは動作したが品質チェックに失敗した場合
    logger.error(`画像 ${slideIndex + 1} は${MAX_RETRIES}回リトライしても品質チェックに合格しませんでした`);
    logger.error('【品質不合格】この画像は投稿に使用できません');

    // 最後の品質チェック結果を報告
    if (lastQualityResult) {
      const failures: string[] = [];
      if (!lastQualityResult.checks.characterPresent) failures.push('キャラクターなし');
      if (!lastQualityResult.checks.characterFeatures) failures.push('キャラクター特徴不一致');
      if (!lastQualityResult.checks.textPresent) failures.push('テキストなし');
      if (!lastQualityResult.checks.textComplete) failures.push('テキスト見切れ');
      if (!lastQualityResult.checks.backgroundValid) failures.push('背景不適切');
      logger.error(`不合格理由: ${failures.join('、')}`);
    }

    // Geminiフォールバックを試行（品質チェック失敗時も）
    logger.warn('=== Gemini フォールバックを開始（品質チェック失敗後）===');
    logger.info('テキストはhtmlComposerで後から合成します');
    for (let geminiAttempt = 1; geminiAttempt <= 3; geminiAttempt++) {
      logger.info(`画像 ${slideIndex + 1} 生成 [Gemini]: 試行 ${geminiAttempt}/3`);

      try {
        const result = await geminiGenerator.generateBackgroundWithImagen3(category);

        if (result.success && result.imagePath) {
          logger.success(`Gemini背景画像生成成功（フォールバック）: ${result.imagePath}`);
          return { imagePath: result.imagePath, qualityResult: null };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`Gemini画像生成エラー（試行 ${geminiAttempt}）: ${errorMsg}`);
      }
    }

    // 全て失敗
    throw new Error(
      `画像 ${slideIndex + 1} の品質チェックに失敗しました。` +
      `Genspark ${MAX_RETRIES}回 + Gemini 3回の試行全てが失敗しました。` +
      `投稿は中止されます。`
    );
  }

  /**
   * 完全なワークフローを実行
   *
   * 【重要】正しいワークフロー（必ず全ステップ実行）:
   * 1. NotebookLMから文体・事業情報を取得
   * 2. 最新ニュースをリアルタイム検索
   * 3. ブログ記事を生成（必須！スキップ禁止！）
   * 4. ブログからInstagram投稿用コンテンツを作成
   * 5. 画像生成プロンプト作成
   * 6. Gensparkで4枚の背景画像を生成（品質チェック・自動リトライ付き）
   * 7. FTPにアップロード
   * 8. Publerでスケジュール
   */
  async execute(options: GensparkWorkflowOptions = {}): Promise<GensparkWorkflowResult> {
    const {
      category = 'ai',
      headless = false,
      skipUpload = false,
      useCharacters = false,
      directTextRendering = false,
      newsInfo: externalNewsInfo,
      skipNotebookLm = false,
      skipNewsResearch = false,
    } = options;
    const topicId = `genspark_${category}_${Date.now()}`;

    logger.info('=== Genspark統合ワークフロー開始 ===');
    logger.info(`カテゴリ: ${category}`);
    logger.info('【重要】ブログ先行型ワークフロー: 常に有効');
    if (useCharacters) {
      logger.info('キャラクターモード: 有効');
    }
    if (directTextRendering) {
      logger.info('直接テキスト描画モード: 有効');
    }

    try {
      // ========================================
      // ステップ0: NotebookLMから文体・事業情報を取得
      // 【必須】毎回実行すること！
      // ========================================
      let businessInfo: BusinessInfo | null = null;
      if (!skipNotebookLm) {
        logger.info('ステップ0: NotebookLMから文体・事業情報を取得...');
        try {
          businessInfo = await notebookLmClient.getBusinessInfo();
          logger.success('NotebookLMから情報取得完了');
          logger.info(`  - 文体ルール: ${businessInfo.brandVoice.slice(0, 50)}...`);
          logger.info(`  - ターゲット: ${businessInfo.targetAudience.slice(0, 50)}...`);
        } catch (error) {
          logger.warn(`NotebookLM取得エラー（フォールバック使用）: ${error}`);
          // フォールバック情報は notebookLmClient 内で自動的に返される
        }
      } else {
        logger.warn('【デバッグ】NotebookLMをスキップ');
      }

      // ========================================
      // ステップ1: 最新ニュースをリアルタイム検索
      // 【必須】毎回実行すること！
      // ========================================
      let newsInfo: NewsInfo;
      if (externalNewsInfo) {
        // 外部から渡された場合はそれを使用
        newsInfo = externalNewsInfo;
        logger.info('ステップ1: 外部からのニュース情報を使用');
      } else if (!skipNewsResearch) {
        logger.info('ステップ1: 最新ニュースをリアルタイム検索中...');
        const researchResult = await newsResearcher.researchLatestNews(category);
        newsInfo = researchResult.newsInfo;
        logger.success(`最新ニュース取得完了: ${newsInfo.headline}`);
      } else {
        logger.warn('【デバッグ】ニュースリサーチをスキップ - デフォルトトピック使用');
        newsInfo = {
          headline: `${category}の最新動向`,
          summary: `${category}分野の最新トレンドについて`,
          details: ['詳細情報1', '詳細情報2', '詳細情報3'],
          implications: ['影響1', '影響2'],
          sources: [],
          date: new Date().toISOString().split('T')[0],
        };
      }

      // キャラクター情報を取得（必要な場合）
      let characters: Map<CharacterRole, Character> | null = null;
      if (useCharacters || directTextRendering) {
        logger.info('キャラクター情報を読み込み中...');
        characters = await getAllCharacters();
        logger.success(`${characters.size}人のキャラクターを読み込み`);
      }

      // ========================================
      // ステップ2: ブログ記事を生成
      // 【必須】絶対にスキップ禁止！
      // ========================================
      logger.info('ステップ2: ブログ記事を生成中...【必須ステップ】');

      // 2-1. ニュース情報からブログを生成
      const blog = await blogGenerator.generateBlogFromNews(newsInfo, category);

      // 2-2. ブログを保存
      await blogGenerator.saveBlog(blog, topicId);
      logger.success(`ブログ記事を保存: ${blog.title}`);

      // ========================================
      // ステップ3: ブログからInstagram投稿用の要約を生成
      // 【必須】ブログから抽出すること！
      // ========================================
      logger.info('ステップ3: ブログからInstagram要約を生成中...');
      const instaSummary = await blogGenerator.generateInstagramSummary(blog, category);

      const title = instaSummary.title;
      const slides = instaSummary.slides;
      let caption = instaSummary.caption;

      // 文体ルールを適用（NotebookLMから取得した場合）
      if (businessInfo) {
        // キャプションに文体ルールが適用されているか確認・調整
        if (businessInfo.brandVoice.includes('絵文字禁止')) {
          // 絵文字を除去
          caption = caption.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
        }
      }

      logger.success(`コンテンツ生成完了: ${title}`);

      // 4枚構成に調整（表紙1 + 内容3）
      const adjustedSlides = this.adjustSlidesToFourSlides(slides);

      // ========================================
      // ステップ4: 画像プロンプト生成
      // ========================================
      logger.info('ステップ4: 画像プロンプト生成中...');
      let imagePrompts: string[];
      let referenceImages: string[] | undefined;

      if (directTextRendering && useCharacters && characters) {
        // NanoBananaProで完全画像生成（キャラクター参照画像 + テキスト + 背景を一体化）
        const result = await this.generateNanoBananaProPrompts(
          category,
          adjustedSlides,
          title,
          characters
        );
        imagePrompts = result.prompts;
        referenceImages = result.referenceImages;
        logger.info('NanoBananaPro用完全画像生成プロンプトを生成（キャラクター参照画像付き）');
      } else if (directTextRendering) {
        // NanoBananaProでテキスト描画（キャラクターなし）
        const result = await this.generateNanoBananaProPrompts(
          category,
          adjustedSlides,
          title
        );
        imagePrompts = result.prompts;
        logger.info('NanoBananaPro用テキスト描画プロンプトを生成');
      } else {
        // 従来の背景のみプロンプト（HTMLで後からテキスト合成）
        imagePrompts = await this.generateImagePrompts(category, adjustedSlides, title);
      }
      logger.success(`${imagePrompts.length}枚の画像プロンプトを生成`);

      // ========================================
      // ステップ5: Gensparkで画像生成（品質チェック・自動リトライ付き）
      // ========================================
      logger.info('ステップ5: Gensparkで画像生成中（品質チェック有効）...');

      // ヘッドレスモードを設定（GitHub Actions等のCI環境用）
      gensparkPlaywright.setHeadless(headless);

      const generatedImages: string[] = [];
      const qualityResults: (QualityCheckResult | null)[] = [];

      // キャラクターを交互に使用
      const jukucho = characters?.get('塾長');
      const jukuto = characters?.get('塾頭');

      for (let i = 0; i < imagePrompts.length; i++) {
        const slide = adjustedSlides[i];
        const useJukucho = i % 2 === 0;
        const character = useJukucho ? jukucho : jukuto;
        const refImage = referenceImages?.[i] || undefined;

        try {
          const result = await this.generateImageWithQualityCheck(
            imagePrompts[i],
            i,
            slide,
            category,
            character,
            refImage
          );
          generatedImages.push(result.imagePath);
          qualityResults.push(result.qualityResult);
        } catch (error) {
          // 【重要】品質チェックに失敗した画像は使用しない！
          // フォールバックで品質チェックをスキップすることは絶対に許可しない
          logger.error(`画像 ${i + 1} の生成に失敗: ${error}`);
          logger.error('【致命的エラー】品質基準を満たす画像を生成できませんでした');
          logger.error('ワークフローを中止します。投稿は行いません。');

          // クリーンアップ
          await gensparkPlaywright.close();

          // エラーを再スロー
          throw error;
        }
      }

      // 全画像が生成されたか確認
      if (generatedImages.length !== 4) {
        throw new Error(`4枚の画像が必要ですが、${generatedImages.length}枚しか生成できませんでした`);
      }

      // Geminiフォールバックで生成された画像を検出（qualityResult === null）
      const imagen3FallbackIndices: number[] = [];
      for (let i = 0; i < qualityResults.length; i++) {
        if (qualityResults[i] === null) {
          imagen3FallbackIndices.push(i);
        }
      }

      // Genspark生成画像の品質チェック確認
      const gensparkResults = qualityResults.filter(r => r !== null);
      const gensparkPassedCount = gensparkResults.filter(r => r?.isValid).length;

      if (imagen3FallbackIndices.length > 0) {
        logger.info(`Geminiフォールバック使用: ${imagen3FallbackIndices.length}枚`);
        logger.info('これらの画像にはhtmlComposerでテキストを合成します');
      }

      if (gensparkResults.length > 0 && gensparkPassedCount < gensparkResults.length) {
        logger.warn(`Genspark生成画像: ${gensparkPassedCount}/${gensparkResults.length}枚が品質チェック合格`);
      }

      logger.success(`全${generatedImages.length}枚の画像生成完了`);

      let finalImages: string[];

      // ========================================
      // ステップ6: 最終画像を作成
      // Geminiフォールバック画像にはhtmlComposerでテキスト合成
      // ========================================
      if (imagen3FallbackIndices.length > 0) {
        // Geminiで生成された背景画像にHTMLでテキストを合成
        logger.info('ステップ6: Gemini画像にhtmlComposerでテキスト合成...');
        finalImages = [...generatedImages];

        for (const idx of imagen3FallbackIndices) {
          const slide = adjustedSlides[idx];
          const backgroundImage = generatedImages[idx];
          const outputPath = path.join(
            path.dirname(backgroundImage),
            `slide_${idx + 1}_with_text.jpg`
          );

          try {
            let composedPath: string;
            if (slide.type === 'cover') {
              composedPath = await htmlComposer.renderCoverSlide(slide, backgroundImage, outputPath);
            } else if (slide.type === 'thanks') {
              composedPath = await htmlComposer.renderThanksSlide(slide, backgroundImage, outputPath);
            } else {
              composedPath = await htmlComposer.renderContentSlide(
                slide,
                backgroundImage,
                outputPath,
                idx,
                adjustedSlides.length
              );
            }
            finalImages[idx] = composedPath;
            logger.success(`スライド ${idx + 1} にテキスト合成完了`);
          } catch (error) {
            logger.error(`スライド ${idx + 1} のテキスト合成に失敗: ${error}`);
            // 失敗してもGeminiの背景画像を使用（テキストなしで続行）
            logger.warn('テキストなしの背景画像を使用します');
          }
        }

        await htmlComposer.close();
      } else if (directTextRendering) {
        // 直接テキスト描画モード: Gensparkで生成した画像をそのまま使用（完成品）
        logger.info('ステップ6: Genspark生成画像をそのまま使用（完成品）');
        finalImages = generatedImages;

        // 出力ディレクトリにコピー
        const outputDir = path.join(PATHS.generated, topicId);
        await fs.mkdir(outputDir, { recursive: true });

        const copiedImages: string[] = [];
        for (let i = 0; i < finalImages.length; i++) {
          const destPath = path.join(outputDir, `slide_${i + 1}.jpg`);
          await fs.copyFile(finalImages[i], destPath);
          copiedImages.push(destPath);
          logger.info(`スライド ${i + 1}/${finalImages.length} をコピーしました`);
        }
        finalImages = copiedImages;
        logger.success(`${finalImages.length}枚の最終画像を生成`);
        // directTextRenderingモードではキャラクター合成はスキップ（既に一体化済み）
      } else {
        // HTMLテンプレートと合成
        logger.info('ステップ6: 最終画像を合成中...');
        finalImages = await htmlComposer.generateCarouselSlides(
          adjustedSlides,
          generatedImages,
          topicId
        );
        await htmlComposer.close();
        logger.success(`${finalImages.length}枚の最終画像を生成`);

        // HTMLモードの場合のみキャラクター合成（有効な場合）
        if (useCharacters) {
          logger.info('ステップ6.5: キャラクターを合成中...');
          const outputDir = path.join(PATHS.generated, topicId);

          // 元の画像を上書きしてキャラクターを合成
          const characterImages = await characterCompositor.compositeCarousel(
            finalImages,
            outputDir,
            topicId
          );

          // キャラクター合成版を最終画像として使用
          finalImages = characterImages;
          logger.success(`${finalImages.length}枚にキャラクターを合成しました`);
        }
      }

      // ========================================
      // ステップ7: FTPアップロード
      // ========================================
      let publicUrls: string[] = [];
      if (!skipUpload) {
        logger.info('ステップ7: FTPにアップロード中...');
        publicUrls = await ftpUploader.uploadCarouselImages(finalImages, topicId);
        logger.success(`${publicUrls.length}枚をアップロード完了`);
      } else {
        logger.info('ステップ7: FTPアップロードをスキップ');
      }

      logger.success('=== Genspark統合ワークフロー完了 ===');

      // 投稿履歴に保存
      try {
        await postHistory.addPost({
          category,
          title,
          topic: newsInfo?.headline || title,
          slides: adjustedSlides.map(s => ({
            headline: s.headline,
            points: s.points,
          })),
          caption,
          outputPath: finalImages[0] || '',
          isAutoGenerated: true,
          executionTime: postHistory.getExecutionTime(),
          topicId,
          imageUrls: publicUrls.length > 0 ? publicUrls : finalImages,
          newsSource: newsInfo?.headline,
        });
        logger.info('投稿履歴に保存しました');
      } catch (historyError) {
        logger.warn('投稿履歴の保存に失敗しました');
      }

      // ========================================
      // ステップ8: Publerで投稿をスケジュール
      // ========================================
      if (publicUrls.length > 0) {
        try {
          logger.info('ステップ8: Publerで投稿をスケジュール中...');
          const { jobId, scheduledAt } = await publerApi.scheduleFromWorkflowResult({
            imageUrls: publicUrls,
            caption,
          });
          logger.success('Publer投稿スケジュール完了');
          logger.info(`ジョブID: ${jobId}`);
          logger.info(`投稿予定日時: ${scheduledAt.toLocaleString('ja-JP')}`);
        } catch (publerError) {
          logger.warn(`Publer投稿スケジュールに失敗しました: ${publerError}`);
        }
      }

      return {
        success: true,
        topicId,
        title,
        slides: adjustedSlides,
        localImages: finalImages,
        publicUrls,
        caption,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`ワークフローエラー: ${errorMessage}`);

      // クリーンアップ
      await gensparkPlaywright.close();
      await htmlComposer.close();

      return {
        success: false,
        topicId,
        title: '',
        slides: [],
        localImages: [],
        publicUrls: [],
        caption: '',
        error: errorMessage,
      };
    }
  }

  /**
   * スライドを4枚構成に調整
   * 表紙1枚 + 内容3枚
   */
  private adjustSlidesToFourSlides(slides: Slide[]): Slide[] {
    const result: Slide[] = [];

    // 表紙を追加
    const cover = slides.find((s) => s.type === 'cover');
    if (cover) {
      result.push(cover);
    } else if (slides.length > 0) {
      // 表紙がない場合は最初のスライドを表紙として使用
      result.push({ ...slides[0], type: 'cover' });
    }

    // 内容スライドを3枚追加
    const contentSlides = slides.filter((s) => s.type === 'content');
    for (let i = 0; i < Math.min(3, contentSlides.length); i++) {
      result.push(contentSlides[i]);
    }

    // 足りない場合は補完
    while (result.length < 4) {
      result.push({
        type: 'content',
        headline: 'もっと詳しく知りたい方へ',
        points: ['プロフィールをチェック', 'DMでお気軽にどうぞ', 'フォローお待ちしてます'],
      });
    }

    return result;
  }

  /**
   * Gensparkにログイン（初回セットアップ用）
   */
  async setupGensparkLogin(): Promise<boolean> {
    logger.info('Gensparkログインセットアップを開始...');
    return gensparkPlaywright.login();
  }

  /**
   * FTP接続テスト
   */
  async testFtpConnection(): Promise<boolean> {
    logger.info('FTP接続テストを開始...');
    return ftpUploader.testConnection();
  }
}

export const gensparkWorkflow = new GensparkWorkflow();
