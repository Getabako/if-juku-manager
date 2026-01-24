/**
 * 全カテゴリ一括生成スクリプト
 * 6カテゴリすべてのカルーセルと動画を生成してテスト
 *
 * 実行方法:
 * npm run generate:all
 * npx tsx src/generateAllCategories.ts
 */
import path from 'path';
import fs from 'fs/promises';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { contentGenerator } from './lib/contentGenerator.js';
import { eventManager } from './lib/eventManager.js';
import { geminiGenerator } from './lib/geminiImageGenerator.js';
import { htmlComposer } from './lib/htmlComposer.js';
import { logger } from './lib/logger.js';
import { PATHS } from './lib/config.js';
import type { CategoryType, Slide, Topic } from './lib/types.js';

// ロゴとサンクス画像のパス
const LOGO_PATH = path.join(PATHS.rawPhotos, 'logo.png');
const THANKS_IMAGE_PATH = path.join(PATHS.rawPhotos, 'ifjukuthanksreel.png');
const BROWSER_EXECUTABLE = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

// カテゴリ一覧
const ALL_CATEGORIES: CategoryType[] = [
  'announcement',
  'development',
  'activity',
  'education',
  'ai',
  'business'
];

const CATEGORY_NAMES: Record<CategoryType, string> = {
  announcement: 'お知らせ',
  development: '開発物',
  activity: '活動報告',
  education: '教育コラム',
  ai: 'AIコラム',
  business: 'ビジネスコラム'
};

interface GenerationResult {
  category: CategoryType;
  categoryName: string;
  success: boolean;
  carouselImages?: string[];
  videoPath?: string;
  caption?: string;
  error?: string;
}

/**
 * 画像をBase64データURLに変換
 */
async function imageToDataUrl(imagePath: string): Promise<string> {
  const absolutePath = path.resolve(imagePath);
  const imageBuffer = await fs.readFile(absolutePath);
  const base64 = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mimeType};base64,${base64}`;
}

/**
 * カテゴリ別にコンテンツを生成
 */
async function generateForCategory(category: CategoryType): Promise<GenerationResult> {
  const categoryName = CATEGORY_NAMES[category];
  logger.info(`\n${'='.repeat(50)}`);
  logger.info(`【${categoryName}】の生成を開始`);
  logger.info(`${'='.repeat(50)}`);

  const result: GenerationResult = {
    category,
    categoryName,
    success: false
  };

  try {
    // 1. コンテンツを動的に生成
    logger.info('Geminiでコンテンツを生成中...');

    let content;
    if (category === 'activity') {
      // 活動報告は実際のイベントデータを使用
      const report = await eventManager.getUnusedActivityReport();
      if (report) {
        const photoPaths = await eventManager.getPhotoPathsForReport(report);
        if (photoPaths.length > 0) {
          content = await contentGenerator.generateContent({
            category,
            photos: photoPaths.map(p => ({
              filename: path.basename(p),
              filepath: p,
              event: report.title,
              people: report.participants,
              expression: 'unknown',
              pose: 'unknown',
              description: report.description,
              category: 'activity'
            }))
          });
        } else {
          content = await contentGenerator.generateContent({ category });
        }
      } else {
        content = await contentGenerator.generateContent({ category });
      }
    } else if (category === 'announcement') {
      // お知らせは実際のイベントデータを使用
      const announcement = await eventManager.getUnusedAnnouncement();
      if (announcement) {
        const topic = await eventManager.generateAnnouncementTopic(announcement);
        content = {
          title: topic.title,
          slides: topic.slides,
          caption: topic.caption,
          imagePrompts: []
        };
      } else {
        content = await contentGenerator.generateContent({ category });
      }
    } else {
      // その他はGeminiで動的生成
      content = await contentGenerator.generateContent({ category });
    }

    logger.success(`コンテンツ生成完了: ${content.title}`);
    logger.info(`スライド数: ${content.slides.length}`);

    // 2. 出力ディレクトリを作成
    const outputDir = path.join(PATHS.generated, `test_${category}_${Date.now()}`);
    await fs.mkdir(outputDir, { recursive: true });

    // 3. 背景画像を生成
    logger.info('背景画像を準備中...');
    const backgroundImages: string[] = [];

    // コンテンツ固有の画像プロンプトがあれば使用
    if (content.imagePrompts && content.imagePrompts.length > 0) {
      for (let i = 0; i < Math.min(content.slides.length, content.imagePrompts.length); i++) {
        const prompt = content.imagePrompts[i];

        // USE_PHOTO: プレフィックスがある場合は実際の写真を使用
        if (prompt && prompt.startsWith('USE_PHOTO:')) {
          const parts = prompt.split(':');
          const photoPath = parts[1];
          logger.info(`実際の写真を使用: ${path.basename(photoPath)}`);
          // 写真を元にスタイライズした背景を生成
          const result = await geminiGenerator.generateFromReference(photoPath, category);
          if (result.success && result.imagePath) {
            backgroundImages.push(result.imagePath);
          } else {
            // フォールバック：元の写真をそのまま使用
            backgroundImages.push(photoPath);
          }
          await delay(1500);
        } else if (prompt && prompt !== '実際の写真を使用するため不要') {
          logger.info(`コンテンツ連動画像を生成: ${prompt.slice(0, 50)}...`);
          const result = await geminiGenerator.generateContentSpecificBackground(prompt, 'carousel');
          if (result.success && result.imagePath) {
            backgroundImages.push(result.imagePath);
          }
          await delay(1500);
        }
      }
    }

    // 足りない分は通常生成
    while (backgroundImages.length < content.slides.length) {
      logger.info(`追加の背景画像を生成中... (${backgroundImages.length + 1}/${content.slides.length})`);
      const result = await geminiGenerator.generateCarouselBackground(category);
      if (result.success && result.imagePath) {
        backgroundImages.push(result.imagePath);
      }
      await delay(1500);
    }

    logger.success(`${backgroundImages.length}枚の背景画像を準備完了`);

    // 4. カルーセル画像を生成
    logger.info('カルーセル画像を合成中...');
    const slideImages = await htmlComposer.generateCarouselSlides(
      content.slides,
      backgroundImages,
      `test_${category}`
    );
    result.carouselImages = slideImages;
    logger.success(`${slideImages.length}枚のカルーセル画像を生成`);

    // 5. 動画を生成（スライドが3枚以上ある場合）
    if (content.slides.length >= 3) {
      logger.info('動画を生成中...');
      try {
        // 画像をBase64に変換
        const backgroundDataUrls = await Promise.all(
          backgroundImages.slice(0, 3).map(img => imageToDataUrl(img))
        );
        const logoDataUrl = await imageToDataUrl(LOGO_PATH);
        const thanksDataUrl = await imageToDataUrl(THANKS_IMAGE_PATH);

        // Remotionバンドル
        const bundleLocation = await bundle({
          entryPoint: path.resolve('./src/remotion/index.ts'),
          webpackOverride: (config) => config,
        });

        const inputProps = {
          slides: content.slides.slice(0, 3),
          backgroundImages: backgroundDataUrls,
          logoPath: logoDataUrl,
          thanksImagePath: thanksDataUrl,
        };

        const composition = await selectComposition({
          serveUrl: bundleLocation,
          id: 'ReelVideo',
          inputProps,
          browserExecutable: BROWSER_EXECUTABLE,
        });

        const videoPath = path.join(outputDir, `reel_${category}.mp4`);
        await renderMedia({
          composition,
          serveUrl: bundleLocation,
          codec: 'h264',
          outputLocation: videoPath,
          inputProps,
          browserExecutable: BROWSER_EXECUTABLE,
        });

        result.videoPath = videoPath;
        logger.success(`動画生成完了: ${videoPath}`);
      } catch (videoError) {
        logger.warn(`動画生成をスキップ: ${videoError instanceof Error ? videoError.message : '不明なエラー'}`);
      }
    }

    // 6. キャプションを保存
    result.caption = content.caption;
    const captionPath = path.join(outputDir, 'caption.txt');
    await fs.writeFile(captionPath, content.caption, 'utf-8');

    // 7. メタデータを保存
    const metadataPath = path.join(outputDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify({
      category,
      categoryName,
      title: content.title,
      slides: content.slides,
      caption: content.caption,
      generatedAt: new Date().toISOString()
    }, null, 2), 'utf-8');

    result.success = true;
    logger.success(`【${categoryName}】の生成が完了しました`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    result.error = errorMessage;
    logger.error(`【${categoryName}】の生成に失敗: ${errorMessage}`);
  }

  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * メイン処理：全カテゴリを順次生成
 */
async function main() {
  const startTime = Date.now();
  logger.info('========================================');
  logger.info('全カテゴリ一括生成を開始');
  logger.info(`対象カテゴリ: ${ALL_CATEGORIES.length}件`);
  logger.info('========================================');

  const results: GenerationResult[] = [];

  for (const category of ALL_CATEGORIES) {
    try {
      const result = await generateForCategory(category);
      results.push(result);
    } catch (error) {
      logger.error(`カテゴリ ${category} の生成中にエラー`);
      results.push({
        category,
        categoryName: CATEGORY_NAMES[category],
        success: false,
        error: error instanceof Error ? error.message : '不明なエラー'
      });
    }

    // カテゴリ間で少し待機
    await delay(2000);
  }

  // HTMLコンポーザーを終了
  await htmlComposer.close();

  // 結果サマリーを出力
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n');
  logger.info('========================================');
  logger.info('生成結果サマリー');
  logger.info('========================================');

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`\n✅ 成功: ${successCount}件`);
  console.log(`❌ 失敗: ${failCount}件`);
  console.log(`⏱️ 所要時間: ${duration}分\n`);

  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.categoryName} (${result.category})`);
    if (result.success) {
      console.log(`   📸 カルーセル: ${result.carouselImages?.length || 0}枚`);
      console.log(`   🎬 動画: ${result.videoPath ? 'あり' : 'なし'}`);
    } else {
      console.log(`   エラー: ${result.error}`);
    }
    console.log('');
  }

  // 結果をJSONファイルに保存
  const summaryPath = path.join(PATHS.generated, `generation_summary_${Date.now()}.json`);
  await fs.writeFile(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    duration: `${duration}分`,
    totalCategories: ALL_CATEGORIES.length,
    successCount,
    failCount,
    results: results.map(r => ({
      category: r.category,
      categoryName: r.categoryName,
      success: r.success,
      carouselCount: r.carouselImages?.length || 0,
      hasVideo: !!r.videoPath,
      error: r.error
    }))
  }, null, 2), 'utf-8');

  logger.info(`サマリーを保存: ${summaryPath}`);

  // 失敗があった場合はエラーコードで終了
  if (failCount > 0) {
    process.exit(1);
  }
}

// 直接実行された場合
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('致命的エラー:', error);
      process.exit(1);
    });
}

export { generateForCategory, ALL_CATEGORIES, CATEGORY_NAMES };
