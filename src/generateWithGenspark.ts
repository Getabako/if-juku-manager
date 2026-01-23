/**
 * Genspark画像生成ワークフロー実行スクリプト
 *
 * 【重要】正しいワークフロー（必ず全ステップ実行）:
 * 1. NotebookLMから文体・事業情報を取得
 * 2. 最新ニュースをリアルタイム検索
 * 3. ブログ記事を生成（必須！スキップ禁止！）
 * 4. ブログからInstagram投稿用コンテンツを作成
 * 5. 画像生成プロンプト作成
 * 6. Gensparkで4枚の背景画像を生成
 * 7. FTPにアップロード
 * 8. Publerでスケジュール
 *
 * 使用方法:
 *   npm run generate:genspark              # 通常実行（完全ワークフロー）
 *   npm run generate:genspark -- --category=ai  # カテゴリ指定
 *   npm run generate:genspark -- --setup   # Gensparkログインセットアップ
 *   npm run generate:genspark -- --test-ftp # FTP接続テスト
 *   npm run generate:genspark -- --skip-upload # アップロードスキップ（ローカル確認用）
 *   npm run generate:genspark -- --no-characters # キャラクターなし
 *   npm run generate:genspark -- --html-mode # HTMLでテキスト合成（従来モード）
 *
 * デバッグ用（本番では使用禁止）:
 *   --skip-notebooklm # NotebookLMをスキップ
 *   --skip-news       # ニュースリサーチをスキップ
 */
import path from 'path';
import { gensparkWorkflow } from './lib/gensparkWorkflow.js';
import { ftpUploader } from './lib/ftpUploader.js';
import { logger } from './lib/logger.js';
import { PATHS } from './lib/config.js';
import type { CategoryType } from './lib/types.js';

interface CliOptions {
  category?: CategoryType;
  setup?: boolean;
  testFtp?: boolean;
  skipUpload?: boolean;
  headless?: boolean;
  useCharacters?: boolean;
  directTextRendering?: boolean;
  // デバッグ用（通常は使用しない）
  skipNotebookLm?: boolean;
  skipNewsResearch?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    // デフォルト: NanoBananaProでテキスト描画 + キャラクター合成
    useCharacters: true,
    directTextRendering: true,
  };

  for (const arg of args) {
    if (arg === '--setup') {
      options.setup = true;
    } else if (arg === '--test-ftp') {
      options.testFtp = true;
    } else if (arg === '--skip-upload') {
      options.skipUpload = true;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--no-characters') {
      options.useCharacters = false;
    } else if (arg === '--html-mode' || arg === '--html') {
      // 従来モード（HTMLでテキスト合成）
      options.directTextRendering = false;
    } else if (arg.startsWith('--category=')) {
      options.category = arg.split('=')[1] as CategoryType;
    } else if (arg === '--skip-notebooklm') {
      // デバッグ用: NotebookLMをスキップ
      options.skipNotebookLm = true;
    } else if (arg === '--skip-news') {
      // デバッグ用: ニュースリサーチをスキップ
      options.skipNewsResearch = true;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs();

  logger.info('Genspark画像生成ワークフロー');
  logger.info('==============================');

  // Gensparkログインセットアップ
  if (options.setup) {
    logger.info('Gensparkログインセットアップモード');
    logger.info('ブラウザが開きますので、手動でログインしてください。');
    logger.info('ログイン完了後、セッションが保存されます。');

    const success = await gensparkWorkflow.setupGensparkLogin();

    if (success) {
      logger.success('ログインセットアップ完了！');
      logger.info('次回からは自動でログインが維持されます。');
    } else {
      logger.error('ログインセットアップに失敗しました');
    }

    process.exit(success ? 0 : 1);
  }

  // FTP接続テスト
  if (options.testFtp) {
    logger.info('FTP接続テストモード');
    logger.info('設定情報:');
    const configInfo = ftpUploader.getConfigInfo();
    Object.entries(configInfo).forEach(([key, value]) => {
      logger.info(`  ${key}: ${value}`);
    });

    const success = await gensparkWorkflow.testFtpConnection();

    if (success) {
      logger.success('FTP接続テスト成功！');
    } else {
      logger.error('FTP接続テスト失敗');
      logger.info('以下を確認してください:');
      logger.info('  1. .envファイルのFTP設定が正しいか');
      logger.info('  2. サーバーのFTPアクセスが有効か');
      logger.info('  3. ファイアウォール設定');
    }

    process.exit(success ? 0 : 1);
  }

  // 通常のワークフロー実行
  logger.info('Genspark統合ワークフローを開始します...');
  logger.info('【重要】ブログ先行型ワークフロー: 常に有効');

  logger.info(`カテゴリ: ${options.category || 'ai'}`);
  logger.info(`NotebookLM: ${options.skipNotebookLm ? 'スキップ【デバッグ】' : '有効（文体・事業情報取得）'}`);
  logger.info(`ニュースリサーチ: ${options.skipNewsResearch ? 'スキップ【デバッグ】' : '有効（リアルタイム検索）'}`);
  logger.info(`テキスト描画: ${options.directTextRendering ? 'NanoBananaPro' : 'HTML/CSS'}`);
  logger.info(`キャラクター: ${options.useCharacters ? '有効' : '無効'}`);
  logger.info(`FTPアップロード: ${options.skipUpload ? 'スキップ' : '有効'}`);

  const result = await gensparkWorkflow.execute({
    category: options.category,
    headless: options.headless ?? false,
    skipUpload: options.skipUpload ?? false,
    useCharacters: options.useCharacters ?? false,
    directTextRendering: options.directTextRendering ?? false,
    // デバッグ用オプション（通常は使用しない）
    skipNotebookLm: options.skipNotebookLm,
    skipNewsResearch: options.skipNewsResearch,
  });

  if (result.success) {
    console.log('\n==============================');
    console.log('生成結果');
    console.log('==============================');
    console.log(`トピックID: ${result.topicId}`);
    console.log(`タイトル: ${result.title}`);
    console.log(`\nスライド構成:`);
    result.slides.forEach((slide, i) => {
      console.log(`  ${i + 1}. [${slide.type}] ${slide.headline}`);
    });

    console.log(`\nローカル画像:`);
    result.localImages.forEach((img, i) => {
      console.log(`  ${i + 1}. ${path.basename(img)}`);
    });

    if (result.publicUrls.length > 0) {
      console.log(`\n公開URL（Instagram API用）:`);
      result.publicUrls.forEach((url, i) => {
        console.log(`  ${i + 1}. ${url}`);
      });
    }

    console.log('\nキャプション:');
    console.log('---');
    console.log(result.caption);
    console.log('---');

    process.exit(0);
  } else {
    logger.error(`ワークフロー失敗: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('予期しないエラー:', error.message);
  process.exit(1);
});
