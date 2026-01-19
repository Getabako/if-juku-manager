#!/usr/bin/env npx tsx
/**
 * パーソナライズドコンテンツ生成CLI
 *
 * 高崎翔太の文体を真似たInstagram/Xコンテンツを生成
 *
 * 使用方法:
 *   # Instagram投稿を生成
 *   npx tsx src/generatePersonalizedContent.ts instagram --topic "今日のAI開発"
 *
 *   # X投稿を生成
 *   npx tsx src/generatePersonalizedContent.ts x --topic "新機能リリース"
 *
 *   # カルーセル投稿を生成
 *   npx tsx src/generatePersonalizedContent.ts carousel --topic "AIの活用法" --slides 5
 */

import * as dotenv from 'dotenv';
dotenv.config();

import {
  generateInstagramPost,
  generateXPost,
  generateCarouselSlides,
  checkWritingStyle,
} from './lib/social/contentGenerator.js';
import * as fs from 'fs';
import * as path from 'path';

const PROFILE_DATA_PATH = path.join(__dirname, '../data/social/facebook_posts_for_notebooklm.md');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    showHelp();
    process.exit(1);
  }

  // プロフィールデータの確認
  if (!fs.existsSync(PROFILE_DATA_PATH)) {
    console.error(`
╔════════════════════════════════════════════════════════════════╗
║  プロフィールデータが見つかりません                            ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  先にFacebookデータをパースしてください:                       ║
║  python scripts/parseFacebookExport.py                         ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  switch (command) {
    case 'instagram': {
      const topicIndex = args.indexOf('--topic');
      if (topicIndex === -1 || !args[topicIndex + 1]) {
        console.error('Error: --topic オプションが必要です');
        process.exit(1);
      }

      const topic = args[topicIndex + 1];
      console.log(`\n🎨 Instagram投稿を生成中: ${topic}\n`);

      const post = await generateInstagramPost(topic);

      if (post) {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Instagram投稿案                                               ║
╠════════════════════════════════════════════════════════════════╣

📌 タイトル:
${post.title}

📝 本文:
${post.content}

🏷️ ハッシュタグ:
${post.hashtags.join(' ')}

╚════════════════════════════════════════════════════════════════╝
`);
      } else {
        console.error('生成に失敗しました');
        process.exit(1);
      }
      break;
    }

    case 'x': {
      const topicIndex = args.indexOf('--topic');
      if (topicIndex === -1 || !args[topicIndex + 1]) {
        console.error('Error: --topic オプションが必要です');
        process.exit(1);
      }

      const topic = args[topicIndex + 1];
      console.log(`\n🐦 X投稿を生成中: ${topic}\n`);

      const tweet = await generateXPost(topic);

      if (tweet) {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║  X(Twitter)投稿案                                              ║
╠════════════════════════════════════════════════════════════════╣

${tweet}

文字数: ${tweet.length}/140

╚════════════════════════════════════════════════════════════════╝
`);
      } else {
        console.error('生成に失敗しました');
        process.exit(1);
      }
      break;
    }

    case 'carousel': {
      const topicIndex = args.indexOf('--topic');
      if (topicIndex === -1 || !args[topicIndex + 1]) {
        console.error('Error: --topic オプションが必要です');
        process.exit(1);
      }

      const topic = args[topicIndex + 1];
      const slidesIndex = args.indexOf('--slides');
      const slideCount = slidesIndex !== -1 ? parseInt(args[slidesIndex + 1]) : 5;

      console.log(`\n📱 カルーセル投稿を生成中: ${topic} (${slideCount}枚)\n`);

      const slides = await generateCarouselSlides(topic, slideCount);

      if (slides) {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║  カルーセル投稿案                                              ║
╠════════════════════════════════════════════════════════════════╣
`);
        slides.forEach((slide, i) => {
          console.log(`📄 スライド ${i + 1}:`);
          console.log(`   ${slide}\n`);
        });
        console.log(`╚════════════════════════════════════════════════════════════════╝`);
      } else {
        console.error('生成に失敗しました');
        process.exit(1);
      }
      break;
    }

    case 'check': {
      const textIndex = args.indexOf('--text');
      if (textIndex === -1 || !args[textIndex + 1]) {
        console.error('Error: --text オプションが必要です');
        process.exit(1);
      }

      const text = args[textIndex + 1];
      console.log(`\n📊 文体チェック中...\n`);

      const result = await checkWritingStyle(text);

      console.log(`
╔════════════════════════════════════════════════════════════════╗
║  文体チェック結果                                              ║
╠════════════════════════════════════════════════════════════════╣

スコア: ${result.score}/100

フィードバック:
${result.feedback}

╚════════════════════════════════════════════════════════════════╝
`);
      break;
    }

    case 'status': {
      const exists = fs.existsSync(PROFILE_DATA_PATH);
      let postCount = 0;

      if (exists) {
        const content = fs.readFileSync(PROFILE_DATA_PATH, 'utf-8');
        const match = content.match(/投稿数\*\*: (\d+)/);
        if (match) postCount = parseInt(match[1]);
      }

      console.log(`
╔════════════════════════════════════════════════════════════════╗
║  システムステータス                                            ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  プロフィールデータ: ${exists ? '✅ 読み込み済み' : '❌ 未設定'}                        ║
║  投稿サンプル数: ${String(postCount).padEnd(47)}║
║  Gemini API: ${process.env.GEMINI_API_KEY ? '✅ 設定済み' : '❌ 未設定'}                               ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
      break;
    }

    default:
      showHelp();
      process.exit(1);
  }
}

function showHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  パーソナライズドコンテンツ生成                                ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  コマンド:                                                     ║
║                                                                ║
║  status     システムステータス確認                             ║
║                                                                ║
║  instagram  Instagram投稿を生成                                ║
║             --topic <topic>    トピック（必須）                ║
║                                                                ║
║  x          X(Twitter)投稿を生成                               ║
║             --topic <topic>    トピック（必須）                ║
║                                                                ║
║  carousel   カルーセル投稿を生成                               ║
║             --topic <topic>    トピック（必須）                ║
║             --slides <num>     スライド数（デフォルト: 5）     ║
║                                                                ║
║  check      文体チェック                                       ║
║             --text <text>      チェックするテキスト            ║
║                                                                ║
║  例:                                                           ║
║    npx tsx src/generatePersonalizedContent.ts status           ║
║    npx tsx src/generatePersonalizedContent.ts instagram \\      ║
║        --topic "AIを使った業務効率化"                          ║
║    npx tsx src/generatePersonalizedContent.ts x \\              ║
║        --topic "新しいツールをリリースしました"                ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);
