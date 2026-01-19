/**
 * 開発系Instagram投稿ワークフロー
 *
 * Gemini APIとFacebookプロフィールデータを使用して
 * 高崎さんの文体を真似た開発・技術投稿を生成・投稿
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { generateInstagramPost, checkWritingStyle } from '../lib/social/contentGenerator.js';
import { instagramPoster } from '../lib/instagramPoster.js';
import { logger } from '../lib/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 投稿履歴ファイル
const HISTORY_PATH = path.join(__dirname, '../../data/dev-post-history.json');

// 開発系トピックリスト
const DEV_TOPICS = [
  'Claude Codeを使ったReact開発の体験',
  'Vercelへのデプロイで学んだこと',
  'AIを活用したホームページ制作のコツ',
  'InstagramGeneratorツールの開発秘話',
  'LINE予約システムの機能紹介',
  'LINEメンバーカードシステムの活用法',
  'GitHub Pagesでのツール公開方法',
  'imageCompressツールの便利な使い方',
  'AIで講座資料を一括作成する方法',
  'Gemini APIを使った自動化の実践',
  'プログラミング教育で使えるAIツール紹介',
  'Reactベースのツール開発入門',
  'AIコーディングの失敗談と学び',
  'デプロイ地獄を乗り越えた話',
  'Kitazunaプロジェクト管理ツールの紹介',
];

interface PostHistory {
  posts: Array<{
    date: string;
    topic: string;
    title: string;
    content: string;
    hashtags: string[];
    posted: boolean;
  }>;
}

/**
 * 投稿履歴を読み込む
 */
function loadHistory(): PostHistory {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const data = fs.readFileSync(HISTORY_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.warn('投稿履歴の読み込みに失敗');
  }
  return { posts: [] };
}

/**
 * 投稿履歴を保存
 */
function saveHistory(history: PostHistory): void {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * 最近使用していないトピックを選択
 */
function selectTopic(history: PostHistory): string {
  // 直近7件で使用したトピックを除外
  const recentTopics = history.posts.slice(-7).map(p => p.topic);
  const availableTopics = DEV_TOPICS.filter(t => !recentTopics.includes(t));

  if (availableTopics.length === 0) {
    // 全て使用済みの場合はランダムに選択
    return DEV_TOPICS[Math.floor(Math.random() * DEV_TOPICS.length)];
  }

  return availableTopics[Math.floor(Math.random() * availableTopics.length)];
}

/**
 * 開発系投稿ワークフローを実行
 */
async function runDevPostWorkflow(): Promise<void> {
  logger.info('========================================');
  logger.info('開発系投稿ワークフローを開始');
  logger.info(`実行時刻: ${new Date().toISOString()}`);
  logger.info('========================================');

  try {
    // 投稿履歴を読み込み
    const history = loadHistory();
    logger.info(`過去の投稿数: ${history.posts.length}件`);

    // トピックを選択
    const topic = selectTopic(history);
    logger.info(`選択されたトピック: ${topic}`);

    // Instagram投稿を生成
    logger.info('[Step 1] コンテンツを生成中...');
    const post = await generateInstagramPost(topic);

    if (!post) {
      throw new Error('投稿の生成に失敗しました');
    }

    logger.success('コンテンツ生成完了');
    logger.info(`タイトル: ${post.title}`);
    logger.info(`本文: ${post.content.substring(0, 50)}...`);
    logger.info(`ハッシュタグ: ${post.hashtags.join(' ')}`);

    // 文体チェック
    logger.info('[Step 2] 文体チェック中...');
    const styleCheck = await checkWritingStyle(post.content);
    logger.info(`文体スコア: ${styleCheck.score}/100`);

    if (styleCheck.score < 60) {
      logger.warn(`文体スコアが低いです: ${styleCheck.feedback}`);
    }

    // キャプションを組み立て
    const caption = `${post.title}\n\n${post.content}\n\n${post.hashtags.join(' ')}`;

    // 投稿履歴に追加
    history.posts.push({
      date: new Date().toISOString(),
      topic,
      title: post.title,
      content: post.content,
      hashtags: post.hashtags,
      posted: false,
    });

    // Instagram投稿（APIが設定されている場合）
    if (instagramPoster.isConfigured()) {
      logger.info('[Step 3] Instagramに投稿中...');

      // 注意: 現在は画像なしのテキスト投稿はできないため、
      // 画像を生成するか、カルーセルと組み合わせる必要あり
      logger.warn('Instagram投稿には画像が必要です');
      logger.info('生成されたキャプション:');
      console.log('\n' + caption + '\n');

      // 投稿成功とマーク（テスト用）
      history.posts[history.posts.length - 1].posted = true;
    } else {
      logger.warn('Instagram APIが設定されていません');
      logger.info('生成されたキャプション:');
      console.log('\n' + caption + '\n');
    }

    // 履歴を保存
    saveHistory(history);
    logger.info('投稿履歴を保存しました');

    logger.info('========================================');
    logger.success('開発系投稿ワークフロー完了');
    logger.info('========================================');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    logger.error(`ワークフローエラー: ${errorMessage}`);
    process.exit(1);
  }
}

// 実行
runDevPostWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
