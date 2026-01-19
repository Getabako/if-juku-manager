#!/usr/bin/env npx tsx
/**
 * X(Twitter)投稿インポートCLI
 *
 * X APIは有料のため、データエクスポートからインポートします。
 *
 * 使用方法:
 *   # Xのアーカイブからインポート
 *   npx tsx src/fetchXPosts.ts import --file /path/to/tweets.js
 *
 *   # 手動で投稿を追加（投稿時に実行）
 *   npx tsx src/fetchXPosts.ts add --text "投稿内容"
 *
 * アーカイブのダウンロード方法:
 *   1. X(Twitter)にログイン
 *   2. 設定 > アカウント > データのアーカイブをダウンロード
 *   3. ZIPを展開し、data/tweets.js を使用
 */

import { importAndSaveXPosts, addPost, loadPostsArchive } from './lib/social/xFetcher.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    showHelp();
    process.exit(1);
  }

  switch (command) {
    case 'import': {
      const fileIndex = args.indexOf('--file');
      if (fileIndex === -1 || !args[fileIndex + 1]) {
        console.error('Error: --file オプションが必要です');
        console.error('例: npx tsx src/fetchXPosts.ts import --file /path/to/tweets.js');
        process.exit(1);
      }

      const filePath = args[fileIndex + 1];
      const usernameIndex = args.indexOf('--username');
      const username = usernameIndex !== -1 ? args[usernameIndex + 1] : 'getabakoclub';

      console.log('Importing X posts from archive...\n');

      const archive = await importAndSaveXPosts(filePath, username);

      if (archive) {
        showResult(archive);
      } else {
        console.error('Failed to import posts.');
        process.exit(1);
      }
      break;
    }

    case 'add': {
      const textIndex = args.indexOf('--text');
      if (textIndex === -1 || !args[textIndex + 1]) {
        console.error('Error: --text オプションが必要です');
        console.error('例: npx tsx src/fetchXPosts.ts add --text "投稿内容"');
        process.exit(1);
      }

      const text = args[textIndex + 1];
      const post = addPost({ text });

      console.log(`
╔════════════════════════════════════════════════════════════════╗
║  投稿を追加しました                                            ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  ID: ${post.id.substring(0, 50).padEnd(55)}║
║  日時: ${post.created_at.padEnd(53)}║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
      break;
    }

    case 'show': {
      const archive = loadPostsArchive();
      if (archive) {
        showResult(archive);
      } else {
        console.log('No posts found. Import first with: npx tsx src/fetchXPosts.ts import --file /path/to/tweets.js');
      }
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
║  X(Twitter) 投稿管理ツール                                     ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  コマンド:                                                     ║
║                                                                ║
║  import   Xのアーカイブからインポート                          ║
║           --file <path>     tweets.jsのパス                    ║
║           --username <name> ユーザー名（デフォルト: getabakoclub）║
║                                                                ║
║  add      手動で投稿を追加                                     ║
║           --text <content>  投稿内容                           ║
║                                                                ║
║  show     保存済み投稿を表示                                   ║
║                                                                ║
║  例:                                                           ║
║    npx tsx src/fetchXPosts.ts import --file ~/Downloads/tweets.js
║    npx tsx src/fetchXPosts.ts add --text "新しいAI機能をリリース！"
║    npx tsx src/fetchXPosts.ts show                             ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
}

function showResult(archive: any) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  X投稿アーカイブ                                               ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  ユーザー: @${archive.username.padEnd(48)}║
║  投稿数: ${String(archive.total_posts).padEnd(51)}║
║                                                                ║
║  文体分析:                                                     ║
║  - 平均文字数: ${String(archive.writing_style.average_length).padEnd(44)}║
║  - トーン: ${archive.writing_style.tone_keywords.slice(0, 3).join(', ').padEnd(48)}║
║  - よく使う絵文字: ${archive.writing_style.emoji_usage.slice(0, 5).join(' ').padEnd(40)}║
║  - ハッシュタグ: ${archive.writing_style.hashtag_usage.slice(0, 3).join(' ').padEnd(42)}║
║                                                                ║
║  保存先:                                                       ║
║  - data/social/x_posts.json                                    ║
║  - data/social/x_posts_for_notebooklm.md                       ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);
