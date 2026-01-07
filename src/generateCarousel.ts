/**
 * カルーセル投稿生成メインスクリプト
 *
 * 実行方法:
 * npm run generate:carousel
 *
 * または特定のトピックIDを指定:
 * npx tsx src/generateCarousel.ts --topic=announcement-001
 */
import path from 'path';
import { geminiGenerator } from './lib/geminiImageGenerator.js';
import { htmlComposer } from './lib/htmlComposer.js';
import { topicSelector } from './lib/topicSelector.js';
import { logger } from './lib/logger.js';
import { PATHS } from './lib/config.js';
import type { CarouselGenerationResult, Topic } from './lib/types.js';

interface GenerateOptions {
  topicId?: string;
  useExistingBackgrounds?: string[]; // 既存の背景画像パスを使用
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
    // 1. トピックを選択
    let topic: Topic;
    if (options.topicId) {
      const found = await topicSelector.getTopicById(options.topicId);
      if (!found) {
        throw new Error(`トピック "${options.topicId}" が見つかりません`);
      }
      topic = found;
    } else {
      topic = await topicSelector.getNextTopic();
    }

    logger.info(`選択されたトピック: ${topic.title}`);
    logger.info(`カテゴリ: ${topic.category}`);
    logger.info(`スライド数: ${topic.slides.length}`);

    // 2. 背景画像を生成または使用
    let backgroundImages: string[];

    if (options.useExistingBackgrounds && options.useExistingBackgrounds.length > 0) {
      logger.info('既存の背景画像を使用します');
      backgroundImages = options.useExistingBackgrounds;
    } else {
      logger.info('Gemini で背景画像を生成中...');
      backgroundImages = await geminiGenerator.generateCarouselBackgrounds(
        topic.category
      );
      logger.success(`${backgroundImages.length} 枚の背景画像を生成しました`);
    }

    // 3. HTML テンプレートと合成してスライド画像を生成
    logger.info('スライド画像を生成中...');
    const slideImages = await htmlComposer.generateCarouselSlides(
      topic.slides,
      backgroundImages,
      topic.id
    );

    // 4. ブラウザを終了
    await htmlComposer.close();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.success(`=== カルーセル生成完了 (${duration}秒) ===`);

    // 5. 結果を返す
    const result: CarouselGenerationResult = {
      topicId: topic.id,
      images: slideImages,
      caption: topic.caption,
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
