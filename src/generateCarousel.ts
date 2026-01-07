/**
 * カルーセル投稿生成メインスクリプト
 *
 * 実行方法:
 * npm run generate:carousel
 *
 * または特定のトピックIDを指定:
 * npx tsx src/generateCarousel.ts --topic=announcement-001
 *
 * 動的コンテンツ生成モード:
 * npx tsx src/generateCarousel.ts --dynamic
 */
import path from 'path';
import { geminiGenerator } from './lib/geminiImageGenerator.js';
import { htmlComposer } from './lib/htmlComposer.js';
import { topicSelector } from './lib/topicSelector.js';
import { contentGenerator } from './lib/contentGenerator.js';
import { eventManager } from './lib/eventManager.js';
import { logger } from './lib/logger.js';
import { PATHS } from './lib/config.js';
import type { CarouselGenerationResult, Topic, CategoryType, Slide } from './lib/types.js';

interface GenerateOptions {
  topicId?: string;
  useExistingBackgrounds?: string[]; // 既存の背景画像パスを使用
  useDynamicContent?: boolean; // 動的コンテンツ生成を使用
  category?: CategoryType; // 明示的にカテゴリを指定
}

/**
 * カルーセル投稿を生成
 */
export async function generateCarousel(
  options: GenerateOptions = {}
): Promise<CarouselGenerationResult> {
  const startTime = Date.now();
  logger.info('=== カルーセル生成を開始 ===');

  try {
    let slides: Slide[];
    let caption: string;
    let topicId: string;
    let category: CategoryType;
    let imagePrompts: string[] = [];

    // 1. コンテンツを取得（動的 or 静的）
    if (options.topicId) {
      // 特定のトピックIDが指定された場合は静的トピックを使用
      const found = await topicSelector.getTopicById(options.topicId);
      if (!found) {
        throw new Error(`トピック "${options.topicId}" が見つかりません`);
      }
      slides = found.slides;
      caption = found.caption;
      topicId = found.id;
      category = found.category as CategoryType;
      logger.info(`静的トピックを使用: ${found.title}`);
    } else {
      // 動的コンテンツ生成（デフォルト）
      logger.info('Geminiで動的コンテンツを生成中...');

      // カテゴリを決定（指定がなければ曜日ベース）
      if (options.category) {
        category = options.category;
      } else {
        const todayCategory = await topicSelector.getTodayCategory();
        category = (todayCategory?.id as CategoryType) || 'ai';
      }

      logger.info(`カテゴリ: ${category}`);

      // カテゴリに応じた動的コンテンツを生成
      let content;
      if (category === 'activity') {
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
        content = await contentGenerator.generateContent({ category });
      }

      slides = content.slides;
      caption = content.caption;
      imagePrompts = content.imagePrompts || [];
      topicId = `dynamic_${category}_${Date.now()}`;
      logger.success(`動的コンテンツ生成完了: ${content.title}`);
    }

    logger.info(`スライド数: ${slides.length}`);

    // 2. 背景画像を生成または使用
    let backgroundImages: string[];

    if (options.useExistingBackgrounds && options.useExistingBackgrounds.length > 0) {
      logger.info('既存の背景画像を使用します');
      backgroundImages = options.useExistingBackgrounds;
    } else {
      logger.info('Gemini で背景画像を生成中...');

      backgroundImages = [];
      // コンテンツ固有の画像プロンプトがあれば使用
      if (imagePrompts.length > 0) {
        for (let i = 0; i < Math.min(slides.length, imagePrompts.length); i++) {
          const prompt = imagePrompts[i];
          if (prompt && prompt !== '実際の写真を使用するため不要') {
            const result = await geminiGenerator.generateContentSpecificBackground(prompt, 'carousel');
            if (result.success && result.imagePath) {
              backgroundImages.push(result.imagePath);
            }
          }
          await delay(1500);
        }
      }

      // 足りない分はカテゴリ別のデフォルト背景を生成
      while (backgroundImages.length < slides.length) {
        const result = await geminiGenerator.generateCarouselBackground(category);
        if (result.success && result.imagePath) {
          backgroundImages.push(result.imagePath);
        }
        await delay(1500);
      }

      logger.success(`${backgroundImages.length} 枚の背景画像を生成しました`);
    }

    // 3. HTML テンプレートと合成してスライド画像を生成
    logger.info('スライド画像を生成中...');
    const slideImages = await htmlComposer.generateCarouselSlides(
      slides,
      backgroundImages,
      topicId
    );

    // 4. ブラウザを終了
    await htmlComposer.close();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.success(`=== カルーセル生成完了 (${duration}秒) ===`);

    // 5. 結果を返す
    const result: CarouselGenerationResult = {
      topicId,
      images: slideImages,
      caption,
      generatedAt: new Date(),
    };

    // 結果をログに出力
    logger.info('生成された画像:');
    slideImages.forEach((img, i) => {
      logger.info(`  ${i + 1}. ${path.basename(img)}`);
    });

    return result;
  } catch (error) {
    await htmlComposer.close();
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    logger.error(`カルーセル生成エラー: ${errorMessage}`);
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * コマンドライン引数を解析
 */
function parseArgs(): GenerateOptions {
  const args = process.argv.slice(2);
  const options: GenerateOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--topic=')) {
      options.topicId = arg.split('=')[1];
    }
  }

  return options;
}

// 直接実行された場合
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const options = parseArgs();

  generateCarousel(options)
    .then((result) => {
      console.log('\n--- 生成結果 ---');
      console.log(`トピックID: ${result.topicId}`);
      console.log(`生成画像数: ${result.images.length}`);
      console.log(`出力先: ${path.join(PATHS.generated, result.topicId)}`);
      console.log('\nキャプション:');
      console.log(result.caption);
      process.exit(0);
    })
    .catch((error) => {
      console.error('エラーが発生しました:', error.message);
      process.exit(1);
    });
}
