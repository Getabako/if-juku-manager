/**
 * リール（ショート動画）生成スクリプト
 *
 * 実行方法:
 * npm run generate:reel
 *
 * または特定のトピックIDを指定:
 * npx tsx src/generateReel.ts --topic=announcement-001
 */
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs/promises';
import { geminiGenerator } from './lib/geminiImageGenerator.js';
import { topicSelector } from './lib/topicSelector.js';
import { logger } from './lib/logger.js';
import { PATHS, IMAGE_SIZES } from './lib/config.js';
import type { ReelGenerationResult, Topic, Slide } from './lib/types.js';

// ロゴとサンクス画像のパス
const LOGO_PATH = path.join(PATHS.rawPhotos, 'logo.png');
const THANKS_IMAGE_PATH = path.join(PATHS.rawPhotos, 'ifjukuthanks.png');

interface GenerateReelOptions {
  topicId?: string;
  duration?: 15 | 30; // 秒数
  compositionId?: 'ReelVideo' | 'ReelVideoLong';
}

/**
 * リール動画を生成
 */
export async function generateReel(
  options: GenerateReelOptions = {}
): Promise<ReelGenerationResult> {
  const startTime = Date.now();
  logger.info('=== リール動画生成を開始 ===');

  const duration = options.duration || 15;
  const compositionId = duration === 30 ? 'ReelVideoLong' : 'ReelVideo';

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

    // 2. 背景画像を生成（リール用縦長）
    logger.info('リール用背景画像を生成中...');
    const backgroundImages: string[] = [];

    // スライド数分の背景を生成（最大3枚）
    const slidesToUse = topic.slides.slice(0, 3);
    for (let i = 0; i < slidesToUse.length; i++) {
      const result = await geminiGenerator.generateReelBackground(topic.category);
      if (result.success && result.imagePath) {
        backgroundImages.push(result.imagePath);
      }
      await delay(1000); // レート制限対策
    }

    logger.success(`${backgroundImages.length} 枚の背景画像を生成しました`);

    // 3. Remotion でバンドルを作成
    logger.info('Remotion バンドルを作成中...');
    const bundleLocation = await bundle({
      entryPoint: path.resolve('./src/remotion/index.ts'),
      webpackOverride: (config) => config,
    });

    // 4. コンポジションを選択
    const inputProps = {
      slides: slidesToUse,
      backgroundImages: backgroundImages.map(
        (img) => `file://${path.resolve(img)}`
      ),
      logoPath: `file://${path.resolve(LOGO_PATH)}`,
      thanksImagePath: `file://${path.resolve(THANKS_IMAGE_PATH)}`,
    };

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps,
    });

    // 5. 動画をレンダリング
    const outputDir = path.join(PATHS.generated, topic.id);
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, `reel_${duration}s.mp4`);

    logger.info(`動画をレンダリング中... (${duration}秒)`);
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
    });

    const durationTime = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.success(`=== リール動画生成完了 (${durationTime}秒) ===`);

    const result: ReelGenerationResult = {
      topicId: topic.id,
      videoPath: outputPath,
      caption: topic.caption,
      generatedAt: new Date(),
    };

    logger.info(`出力ファイル: ${outputPath}`);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    logger.error(`リール生成エラー: ${errorMessage}`);
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * コマンドライン引数を解析
 */
function parseArgs(): GenerateReelOptions {
  const args = process.argv.slice(2);
  const options: GenerateReelOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--topic=')) {
      options.topicId = arg.split('=')[1];
    }
    if (arg === '--long' || arg === '--30s') {
      options.duration = 30;
    }
  }

  return options;
}

// 直接実行された場合
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const options = parseArgs();

  generateReel(options)
    .then((result) => {
      console.log('\n--- 生成結果 ---');
      console.log(`トピックID: ${result.topicId}`);
      console.log(`動画ファイル: ${result.videoPath}`);
      console.log('\nキャプション:');
      console.log(result.caption);
      process.exit(0);
    })
    .catch((error) => {
      console.error('エラーが発生しました:', error.message);
      process.exit(1);
    });
}
