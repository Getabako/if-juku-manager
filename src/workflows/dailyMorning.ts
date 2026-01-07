/**
 * 毎朝9:00実行のワークフロー
 * カルーセル投稿を生成・投稿
 */
import { generateCarousel } from '../generateCarousel.js';
import { instagramPoster } from '../lib/instagramPoster.js';
import { logger } from '../lib/logger.js';
import type { CarouselGenerationResult } from '../lib/types.js';

/**
 * 朝のワークフローを実行
 *
 * 1. カルーセル画像を生成
 * 2. (オプション) 画像をCloudにアップロード
 * 3. Instagramに投稿
 */
async function runMorningWorkflow(): Promise<void> {
  logger.info('========================================');
  logger.info('朝のワークフローを開始 (09:00)');
  logger.info(`実行時刻: ${new Date().toISOString()}`);
  logger.info('========================================');

  try {
    // 1. カルーセルを生成
    logger.info('[Step 1] カルーセル画像を生成中...');
    const carouselResult: CarouselGenerationResult = await generateCarousel();

    logger.success(`カルーセル生成完了: ${carouselResult.images.length}枚`);

    // 2. Instagram投稿
    // 注意: 実運用では画像をCloud Storage（例: Cloudinary, AWS S3）に
    // アップロードして公開URLを取得する必要があります
    if (instagramPoster.isConfigured()) {
      logger.info('[Step 2] Instagramに投稿中...');

      // TODO: 画像をCloudにアップロードしてURLを取得
      // const imageUrls = await uploadToCloud(carouselResult.images);
      // const postResult = await instagramPoster.postCarousel(carouselResult, imageUrls);

      logger.warn('Instagram投稿は画像の公開URL化が必要です');
      logger.info('生成された画像パス:');
      carouselResult.images.forEach((img, i) => {
        logger.info(`  ${i + 1}. ${img}`);
      });
    } else {
      logger.warn('Instagram APIが設定されていないため、投稿をスキップします');
      logger.info('生成された画像は以下のパスに保存されています:');
      carouselResult.images.forEach((img, i) => {
        logger.info(`  ${i + 1}. ${img}`);
      });
    }

    logger.info('========================================');
    logger.success('朝のワークフロー完了');
    logger.info('========================================');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    logger.error(`ワークフローエラー: ${errorMessage}`);
    process.exit(1);
  }
}

// 実行
runMorningWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
