/**
 * 毎晩20:00実行のワークフロー
 * リール動画を生成・投稿
 */
import { generateReel } from '../generateReel.js';
import { instagramPoster } from '../lib/instagramPoster.js';
import { logger } from '../lib/logger.js';
import type { ReelGenerationResult } from '../lib/types.js';

/**
 * 夜のワークフローを実行
 *
 * 1. リール動画を生成
 * 2. (オプション) 動画をCloudにアップロード
 * 3. Instagramに投稿
 */
async function runEveningWorkflow(): Promise<void> {
  logger.info('========================================');
  logger.info('夜のワークフローを開始 (20:00)');
  logger.info(`実行時刻: ${new Date().toISOString()}`);
  logger.info('========================================');

  try {
    // 1. リールを生成
    logger.info('[Step 1] リール動画を生成中...');
    const reelResult: ReelGenerationResult = await generateReel({
      duration: 15, // 15秒版
    });

    logger.success(`リール生成完了: ${reelResult.videoPath}`);

    // 2. Instagram投稿
    if (instagramPoster.isConfigured()) {
      logger.info('[Step 2] Instagramに投稿中...');

      // TODO: 動画をCloudにアップロードしてURLを取得
      // const videoUrl = await uploadVideoToCloud(reelResult.videoPath);
      // const postResult = await instagramPoster.postReel(reelResult, videoUrl);

      logger.warn('Instagram投稿は動画の公開URL化が必要です');
      logger.info(`生成された動画: ${reelResult.videoPath}`);
    } else {
      logger.warn('Instagram APIが設定されていないため、投稿をスキップします');
      logger.info(`生成された動画: ${reelResult.videoPath}`);
    }

    logger.info('========================================');
    logger.success('夜のワークフロー完了');
    logger.info('========================================');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    logger.error(`ワークフローエラー: ${errorMessage}`);
    process.exit(1);
  }
}

// 実行
runEveningWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
