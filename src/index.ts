/**
 * if-juku Instagram 自動投稿システム
 * エントリーポイント
 */
import { generateCarousel } from './generateCarousel.js';
import { generateReel } from './generateReel.js';
import { topicSelector } from './lib/topicSelector.js';
import { instagramPoster } from './lib/instagramPoster.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const command = process.argv[2];

  logger.info('if-juku Instagram 自動投稿システム');
  logger.info('=====================================');

  switch (command) {
    case 'carousel':
      await generateCarousel();
      break;

    case 'reel':
      await generateReel();
      break;

    case 'list':
      const topics = await topicSelector.listAllTopics();
      console.log('\n登録されているトピック:');
      topics.forEach((t, i) => {
        console.log(`  ${i + 1}. [${t.category}] ${t.title} (${t.id})`);
      });
      break;

    case 'account':
      if (instagramPoster.isConfigured()) {
        const info = await instagramPoster.getAccountInfo();
        console.log('\nInstagramアカウント情報:');
        console.log(JSON.stringify(info, null, 2));
      } else {
        console.log('Instagram APIが設定されていません');
      }
      break;

    default:
      console.log(`
使用方法:
  npm run dev -- carousel   カルーセル画像を生成
  npm run dev -- reel       リール動画を生成
  npm run dev -- list       登録トピック一覧を表示
  npm run dev -- account    Instagramアカウント情報を表示

または個別のスクリプト:
  npm run generate:carousel
  npm run generate:reel
  npm run daily:morning
  npm run daily:evening
`);
  }
}

main().catch((err) => {
  logger.error('エラーが発生しました:', err.message);
  process.exit(1);
});
