#!/usr/bin/env npx tsx
/**
 * パーソナライズドコンテンツ生成
 *
 * NotebookLMに保存された高崎さんの投稿データを参照し、
 * 文体を真似たInstagram/Xコンテンツを生成します。
 *
 * 使用方法:
 *   # Instagram投稿を生成
 *   npx tsx src/generatePersonalizedContent.ts instagram --topic "今日のAI開発"
 *
 *   # X投稿を生成
 *   npx tsx src/generatePersonalizedContent.ts x --topic "新機能リリース"
 *
 * 事前準備:
 *   1. Facebook/X投稿を取得: npm run fetch:facebook
 *   2. NotebookLMにMarkdownをアップロード
 *   3. NotebookLM認証: npm run notebooklm:auth
 */

import {
  generateInstagramPost,
  generateXPost,
  checkAuthStatus,
  setupAuth,
  listNotebooks,
} from './lib/social/notebookLMClient.js';
import { loadPostsArchive as loadFacebookArchive } from './lib/social/facebookFetcher.js';
import { loadPostsArchive as loadXArchive } from './lib/social/xFetcher.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    showHelp();
    process.exit(1);
  }

  // 認証状態確認
  if (command !== 'auth' && command !== 'status') {
    const isAuth = checkAuthStatus();
    if (!isAuth) {
      console.error(`
╔════════════════════════════════════════════════════════════════╗
║  NotebookLM未認証                                              ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  先に認証を行ってください:                                     ║
║  npx tsx src/generatePersonalizedContent.ts auth               ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
      process.exit(1);
    }
  }

  switch (command) {
    case 'auth': {
      console.log('Starting NotebookLM authentication...');
      setupAuth();
      break;
    }

    case 'status': {
      const isAuth = checkAuthStatus();
      const notebooks = listNotebooks();
      const fbArchive = loadFacebookArchive();
      const xArchive = loadXArchive();

      console.log(`
╔════════════════════════════════════════════════════════════════╗
║  システムステータス                                            ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  NotebookLM認証: ${isAuth ? '✅ 認証済み' : '❌ 未認証'}                                 ║
║  ノートブック数: ${String(notebooks.length).padEnd(46)}║
║                                                                ║
║  データソース:                                                 ║
║  - Facebook投稿: ${fbArchive ? `✅ ${fbArchive.total_posts}件` : '❌ 未取得'}                              ║
║  - X投稿: ${xArchive ? `✅ ${xArchive.total_posts}件` : '❌ 未取得'}                                       ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
      break;
    }

    case 'instagram': {
      const topicIndex = args.indexOf('--topic');
      if (topicIndex === -1 || !args[topicIndex + 1]) {
        console.error('Error: --topic オプションが必要です');
        process.exit(1);
      }

      const topic = args[topicIndex + 1];
      const notebookIndex = args.indexOf('--notebook');
      const notebookId = notebookIndex !== -1 ? args[notebookIndex + 1] : undefined;

      console.log(`\nGenerating Instagram post about: ${topic}\n`);

      const post = await generateInstagramPost(topic, notebookId);

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

🎨 トーン: ${post.tone}

╚════════════════════════════════════════════════════════════════╝
`);
      } else {
        console.error('Failed to generate post.');
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
      const notebookIndex = args.indexOf('--notebook');
      const notebookId = notebookIndex !== -1 ? args[notebookIndex + 1] : undefined;

      console.log(`\nGenerating X post about: ${topic}\n`);

      const tweet = await generateXPost(topic, notebookId);

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
        console.error('Failed to generate tweet.');
        process.exit(1);
      }
      break;
    }

    case 'notebooks': {
      const notebooks = listNotebooks();
      console.log('\nNotebookLM ノートブック一覧:\n');
      if (notebooks.length === 0) {
        console.log('  (ノートブックが登録されていません)');
      } else {
        notebooks.forEach((nb: any, i: number) => {
          console.log(`  ${i + 1}. ${nb.name || nb.id}`);
          if (nb.description) console.log(`     ${nb.description}`);
        });
      }
      console.log('');
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
║  auth       NotebookLM認証（ブラウザが開きます）               ║
║  status     システムステータス確認                             ║
║  notebooks  登録済みノートブック一覧                           ║
║                                                                ║
║  instagram  Instagram投稿を生成                                ║
║             --topic <topic>    トピック（必須）                ║
║             --notebook <id>    ノートブックID                  ║
║                                                                ║
║  x          X(Twitter)投稿を生成                               ║
║             --topic <topic>    トピック（必須）                ║
║             --notebook <id>    ノートブックID                  ║
║                                                                ║
║  セットアップ手順:                                             ║
║  1. npm run fetch:facebook    # Facebook投稿を取得             ║
║  2. NotebookLMに以下をアップロード:                            ║
║     data/social/facebook_posts_for_notebooklm.md               ║
║  3. npm run content:auth      # NotebookLM認証                 ║
║  4. npm run content:generate instagram --topic "トピック"      ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);
