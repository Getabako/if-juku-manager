#!/usr/bin/env npx tsx
/**
 * Facebook投稿取得CLI
 *
 * 使用方法:
 *   npx tsx src/fetchFacebookPosts.ts
 *
 * 環境変数:
 *   FACEBOOK_ACCESS_TOKEN - Facebookアクセストークン
 *
 * アクセストークンの取得方法:
 *   1. https://developers.facebook.com/tools/explorer/ にアクセス
 *   2. 「User Token」を選択
 *   3. 必要な権限を追加:
 *      - user_posts（自分の投稿を読む）
 *      - public_profile（プロフィール情報）
 *   4. 「Generate Access Token」をクリック
 *   5. 生成されたトークンをコピー
 *
 * 注意:
 *   - 短期トークンは約1-2時間で期限切れ
 *   - 長期トークンが必要な場合はアプリ設定から延長可能
 */

import { config } from 'dotenv';
import { fetchAndSaveFacebookPosts, loadPostsArchive } from './lib/social/facebookFetcher.js';

config();

async function main() {
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(`
╔════════════════════════════════════════════════════════════════╗
║  Facebook Access Token が設定されていません                    ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  1. Graph API Explorer にアクセス:                             ║
║     https://developers.facebook.com/tools/explorer/            ║
║                                                                ║
║  2. 「User Token」を選択                                       ║
║                                                                ║
║  3. 権限を追加:                                                ║
║     - user_posts                                               ║
║     - public_profile                                           ║
║                                                                ║
║  4. 「Generate Access Token」をクリック                        ║
║                                                                ║
║  5. .envファイルに追加:                                        ║
║     FACEBOOK_ACCESS_TOKEN=your_token_here                      ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  console.log('Starting Facebook posts fetch...\n');

  const archive = await fetchAndSaveFacebookPosts(accessToken, 200);

  if (archive) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║  取得完了!                                                     ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  投稿数: ${String(archive.total_posts).padEnd(50)}║
║  ユーザー: ${archive.user_name.padEnd(48)}║
║                                                                ║
║  文体分析:                                                     ║
║  - 平均文字数: ${String(archive.writing_style.average_length).padEnd(44)}║
║  - トーン: ${archive.writing_style.tone_keywords.slice(0, 3).join(', ').padEnd(48)}║
║  - よく使う絵文字: ${archive.writing_style.emoji_usage.slice(0, 5).join(' ').padEnd(40)}║
║                                                                ║
║  保存先:                                                       ║
║  - data/social/facebook_posts.json                             ║
║  - data/social/facebook_posts_for_notebooklm.md                ║
║                                                                ║
║  次のステップ:                                                 ║
║  NotebookLMに facebook_posts_for_notebooklm.md を              ║
║  ソースとして追加してください                                  ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
  } else {
    console.error('Failed to fetch posts.');
    process.exit(1);
  }
}

main().catch(console.error);
