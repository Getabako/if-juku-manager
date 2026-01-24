/**
 * Genspark 画像生成モジュール (Playwright版 - ステルス対策付き)
 * notebooklm-skill-masterのアプローチを参考に実装
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PATHS } from './config.js';
import { logger } from './logger.js';
import type { GeminiImageResponse, CategoryType } from './types.js';

// Genspark設定
const GENSPARK_URL = 'https://www.genspark.ai/';
const GENSPARK_IMAGE_URL = 'https://www.genspark.ai/agents?type=image_generation_agent';
const BROWSER_PROFILE_DIR = path.join(PATHS.data, 'genspark_playwright_profile');
const STATE_FILE = path.join(PATHS.data, 'genspark_state.json');
const DOWNLOAD_DIR = path.join(PATHS.generated, 'genspark_downloads');

// タイムアウト設定
const NAVIGATION_TIMEOUT = 60000;
const IMAGE_GENERATION_TIMEOUT = 180000; // 3分

// 自動化検出回避のためのブラウザ設定
const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-infobars',
  '--window-size=1920,1080',
];

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface GensparkImageOptions {
  prompt: string;
  category?: CategoryType;
  style?: string;
  aspectRatio?: '1:1' | '3:4' | '4:5' | '9:16' | '16:9';
  referenceImagePath?: string; // 参照画像（キャラクター等）のパス
}

/**
 * ステルスユーティリティ - 人間らしい操作をシミュレート
 */
class StealthUtils {
  /**
   * ランダムな遅延を追加
   */
  static async randomDelay(minMs: number = 100, maxMs: number = 500): Promise<void> {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 人間らしいタイピング速度でテキストを入力
   * リダイレクト検出付き
   */
  static async humanType(page: Page, selector: string, text: string): Promise<boolean> {
    // 要素をクリックしてフォーカス
    await page.click(selector);
    await this.randomDelay(200, 400);

    // 既存のテキストをクリア
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await this.randomDelay(100, 200);

    const startUrl = page.url();

    // 人間らしいタイピングでテキストを入力
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // 10文字ごとにURLをチェック（リダイレクト検出）
      if (i % 10 === 0) {
        const currentUrl = page.url();
        if (currentUrl !== startUrl && currentUrl.includes('accounts.google.com')) {
          logger.warn('タイピング中にGoogleログインにリダイレクトされました');
          return false; // リダイレクトされた
        }
      }

      await page.keyboard.type(char, { delay: Math.random() * 30 + 15 }); // 15-45ms per char (少し速く)

      // 3%の確率で小休止
      if (Math.random() < 0.03) {
        await this.randomDelay(100, 250);
      }
    }

    return true; // 正常完了
  }

  /**
   * リアルなクリック（マウス移動付き）
   */
  static async realisticClick(page: Page, selector: string): Promise<void> {
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const box = await element.boundingBox();
    if (box) {
      // 要素の中心に向かってマウスを移動
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      // ステップ数を指定してマウス移動
      await page.mouse.move(x, y, { steps: 5 });
      await this.randomDelay(50, 150);
    }

    await element.click();
    await this.randomDelay(100, 300);
  }
}

export class GensparkPlaywrightGenerator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isLoggedIn: boolean = false;
  private headlessMode: boolean = false;

  /**
   * ヘッドレスモードを設定
   */
  setHeadless(headless: boolean): void {
    this.headlessMode = headless;
  }

  /**
   * ブラウザを起動（永続コンテキスト使用）
   */
  async init(headless: boolean = false): Promise<void> {
    if (this.context) {
      return;
    }

    // ディレクトリ作成
    await fs.mkdir(BROWSER_PROFILE_DIR, { recursive: true });
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

    // 永続コンテキストでブラウザ起動（本物のChromeを使用）
    this.context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
      channel: 'chrome', // 本物のChromeを使用
      headless,
      args: BROWSER_ARGS,
      userAgent: USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      ignoreDefaultArgs: ['--enable-automation'],
      acceptDownloads: true,
    });

    // 既存のページを使用するか、新しいページを作成
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // state.jsonからCookieを手動注入（ハイブリッド認証）
    await this.injectCookies();

    logger.info('Genspark Playwrightブラウザを起動しました');
  }

  /**
   * state.jsonからCookieを手動注入
   */
  private async injectCookies(): Promise<void> {
    try {
      const stateData = await fs.readFile(STATE_FILE, 'utf-8');
      const state = JSON.parse(stateData);

      if (state.cookies && state.cookies.length > 0) {
        await this.context!.addCookies(state.cookies);
        logger.debug('Cookieを注入しました');
      }
    } catch {
      logger.debug('state.jsonが見つかりません（初回起動）');
    }
  }

  /**
   * 現在の状態を保存
   */
  async saveState(): Promise<void> {
    if (!this.context) return;

    try {
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      const state = await this.context.storageState();
      await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
      logger.debug('状態を保存しました');
    } catch (error) {
      logger.warn('状態の保存に失敗しました');
    }
  }

  /**
   * ログインページにいるかチェック
   */
  private async isOnLoginPage(): Promise<boolean> {
    if (!this.page) return false;

    try {
      const url = this.page.url();

      // GoogleログインページまたはGensparkログインページ
      if (url.includes('accounts.google.com')) {
        logger.debug('Googleログインページを検出');
        return true;
      }
      if (url.includes('/login') || url.includes('/signin')) {
        return true;
      }

      // Gensparkページでtextareaがあればログイン済み
      if (url.includes('genspark.ai')) {
        const textarea = await this.page.$('textarea');
        if (textarea) {
          return false;
        }
      }

      // ログインページの特徴を検出
      const workspaceTitle = await this.page.$('text=Genspark AI Workspace');
      const loginButton = await this.page.$('text=Login with email');

      return !!(workspaceTitle && loginButton);
    } catch {
      return false;
    }
  }

  /**
   * Googleログイン待機
   */
  private async waitForGoogleLogin(): Promise<void> {
    if (!this.page) return;

    logger.info('Googleログインを完了してください...');
    logger.info('ブラウザでGoogleアカウントにログインしてください');

    // Googleログインが完了するまで待機
    while (true) {
      await StealthUtils.randomDelay(2000, 3000);

      const url = this.page.url();
      // Gensparkに戻ったら完了
      if (url.includes('genspark.ai') && !url.includes('login')) {
        logger.success('Googleログイン完了');
        break;
      }

      // 5分以上待っていたらタイムアウト
      // (実際は無限ループだが、ユーザーが操作するので問題なし)
    }
  }

  /**
   * ログイン（手動操作待機）
   */
  async login(): Promise<boolean> {
    if (!this.context) {
      await this.init(this.headlessMode);
    }

    try {
      logger.info('Gensparkにアクセス中...');
      await this.page!.goto(GENSPARK_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT,
      });
      // ページが安定するまで待機
      await StealthUtils.randomDelay(3000, 5000);

      await StealthUtils.randomDelay(2000, 3000);

      // ログイン状態チェック
      let onLogin = await this.isOnLoginPage();

      if (onLogin) {
        logger.info('ログインが必要です。ブラウザでログインしてください...');

        // ログイン完了を待機
        while (await this.isOnLoginPage()) {
          await StealthUtils.randomDelay(2000, 3000);
        }
      }

      // 画像生成ページでも確認
      logger.info('画像生成ページでセッションを確認中...');
      await this.page!.goto(GENSPARK_IMAGE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT,
      });
      await StealthUtils.randomDelay(3000, 5000);

      onLogin = await this.isOnLoginPage();
      if (onLogin) {
        logger.warn('画像生成機能にはログインが必要です');
        logger.info('ブラウザでログインしてください...');

        while (await this.isOnLoginPage()) {
          await StealthUtils.randomDelay(2000, 3000);
        }
      }

      // 入力欄が表示されることを確認
      try {
        await this.page!.waitForSelector('textarea', { timeout: 15000 });
        logger.success('画像生成ページへのアクセスを確認しました');
      } catch {
        logger.error('画像生成ページにアクセスできません');
        return false;
      }

      // 状態を保存
      await this.saveState();
      this.isLoggedIn = true;
      logger.success('ログイン完了');

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`ログインエラー: ${errorMessage}`);
      return false;
    }
  }

  /**
   * 画像生成ページに移動
   */
  async navigateToImageGenerator(): Promise<boolean> {
    if (!this.page) {
      await this.init();
    }

    try {
      logger.info('画像生成ページに移動中...');

      await this.page!.goto(GENSPARK_IMAGE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT,
      });
      await StealthUtils.randomDelay(3000, 5000);

      // ログインページチェック
      const onLogin = await this.isOnLoginPage();
      if (onLogin) {
        logger.error('セッションが期限切れです。--setupで再ログインしてください。');
        return false;
      }

      // 入力欄を待機
      await this.page!.waitForSelector('textarea', { timeout: 15000 });
      logger.info('AI画像ページに到達しました');

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`ページ移動エラー: ${errorMessage}`);
      return false;
    }
  }

  /**
   * アスペクト比を設定
   */
  async setAspectRatio(): Promise<void> {
    if (!this.page) return;

    try {
      // 設定ボタンをクリック
      const settingsButton = await this.page.$('text=設定');
      if (settingsButton) {
        await StealthUtils.realisticClick(this.page, 'text=設定');
        await StealthUtils.randomDelay(800, 1200);

        // 3:4を選択
        const aspectRatio = await this.page.$('text=3:4');
        if (aspectRatio) {
          await StealthUtils.realisticClick(this.page, 'text=3:4');
          logger.info('アスペクト比を3:4に設定しました');
          await StealthUtils.randomDelay(300, 500);

          await this.page.keyboard.press('Escape');
        }
      }
    } catch {
      logger.debug('アスペクト比の設定をスキップ');
    }
  }

  /**
   * 参照画像をアップロード（ファイルチューザーを使用）
   */
  async uploadReferenceImage(imagePath: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      logger.info(`参照画像をアップロード中: ${path.basename(imagePath)}`);

      // ファイルが存在するか確認
      await fs.access(imagePath);

      // 方法1: fileChooserイベントを待機してボタンをクリック
      logger.info('ファイル選択ダイアログを待機中...');

      // ページ内の全てのボタンを取得し、テキストエリア近くのものを探す
      const textarea = await this.page.$('textarea');
      if (!textarea) {
        logger.warn('textareaが見つかりません');
        return false;
      }

      // textareaの親コンテナを取得
      const parent = await textarea.evaluateHandle((el) => {
        // 親要素を5階層上まで探索
        let container = el.parentElement;
        for (let i = 0; i < 5 && container; i++) {
          container = container.parentElement;
        }
        return container;
      });

      // ファイルチューザーの待機とボタンクリックを同時に行う
      let uploaded = false;

      // まず、ページ全体でfile inputを探す（隠れているものも含む）
      const fileInputs = await this.page.$$('input[type="file"]');
      logger.info(`ページ内のfile input数: ${fileInputs.length}`);

      if (fileInputs.length > 0) {
        // 最初のfile inputを使用
        for (const fileInput of fileInputs) {
          try {
            await fileInput.setInputFiles(imagePath);
            logger.success('file inputに画像をセットしました');
            uploaded = true;
            break;
          } catch (e) {
            continue;
          }
        }
      }

      if (!uploaded) {
        // file inputがない場合、ボタンをクリックしてファイルチューザーを開く
        const buttons = await this.page.$$('button');
        logger.info(`ページ内のボタン数: ${buttons.length}`);

        for (const button of buttons) {
          try {
            // ボタンの位置を確認（画面下部にあるもの = 入力エリア付近）
            const box = await button.boundingBox();
            if (!box || box.y < 500) continue; // 画面上部のボタンはスキップ

            // ファイルチューザーイベントを待機
            const [fileChooser] = await Promise.all([
              this.page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
              button.click(),
            ]);

            if (fileChooser) {
              await fileChooser.setFiles(imagePath);
              logger.success('ファイルチューザー経由でアップロードしました');
              uploaded = true;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      if (uploaded) {
        // アップロード確認を待機
        await StealthUtils.randomDelay(3000, 5000);

        // プレビュー画像を確認
        const preview = await this.page.$('img[src*="blob:"], img[src*="data:image"], [class*="preview"] img, [class*="thumbnail"] img');
        if (preview) {
          logger.success('参照画像のプレビューを確認しました');
        }
        return true;
      }

      // 方法2: クリップボードにコピーしてペースト
      logger.info('クリップボード経由でアップロードを試行中...');

      const fileBuffer = await fs.readFile(imagePath);

      // クリップボードAPIを使用
      const result = await this.page.evaluate(async (imageBase64: string) => {
        try {
          // Base64をBlobに変換
          const byteCharacters = atob(imageBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/png' });

          // ClipboardItemを作成
          const clipboardItem = new ClipboardItem({ 'image/png': blob });

          // クリップボードに書き込み
          await navigator.clipboard.write([clipboardItem]);

          return true;
        } catch (e) {
          console.error('Clipboard error:', e);
          return false;
        }
      }, fileBuffer.toString('base64'));

      if (result) {
        // ペーストを実行
        await textarea.click();
        await StealthUtils.randomDelay(200, 400);
        await this.page.keyboard.press('Meta+v');
        await StealthUtils.randomDelay(2000, 3000);

        logger.info('クリップボードからペーストを試行しました');
        return true;
      }

      logger.warn('参照画像のアップロードに失敗しました');
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`参照画像アップロードエラー: ${errorMessage}`);
      return false;
    }
  }

  /**
   * 画像を生成
   */
  async generateImage(options: GensparkImageOptions): Promise<GeminiImageResponse> {
    if (!this.page) {
      await this.init();
    }

    try {
      logger.info(`画像生成を開始: ${options.prompt.slice(0, 50)}...`);

      // 画像生成ページに移動
      const currentUrl = this.page!.url();
      if (!currentUrl.includes('image_generation_agent')) {
        const navigated = await this.navigateToImageGenerator();
        if (!navigated) {
          throw new Error('画像生成ページへの移動に失敗しました');
        }
      }

      await StealthUtils.randomDelay(1000, 2000);

      // アスペクト比を設定
      if (options.aspectRatio === '3:4' || options.aspectRatio === '4:5') {
        await this.setAspectRatio();
      }

      // 参照画像がある場合はアップロード
      if (options.referenceImagePath) {
        const uploaded = await this.uploadReferenceImage(options.referenceImagePath);
        if (!uploaded) {
          logger.warn('参照画像のアップロードに失敗しましたが、テキストのみで続行します');
        }
        // Gensparkが画像を認識するまで十分待機
        logger.info('画像認識を待機中...');
        await StealthUtils.randomDelay(3000, 5000);
      }

      // プロンプト入力欄を探す
      const textarea = await this.page!.$('textarea');
      if (!textarea) {
        throw new Error('プロンプト入力欄が見つかりません');
      }

      // 人間らしいタイピングでプロンプトを入力
      const typingSuccess = await StealthUtils.humanType(this.page!, 'textarea', options.prompt);

      // タイピング中にリダイレクトされた場合
      if (!typingSuccess) {
        logger.warn('Googleログインが必要です');
        await this.waitForGoogleLogin();

        // 状態を保存
        await this.saveState();

        // 画像生成ページに戻る
        await this.navigateToImageGenerator();

        // もう一度プロンプトを入力
        const retrySuccess = await StealthUtils.humanType(this.page!, 'textarea', options.prompt);
        if (!retrySuccess) {
          throw new Error('Googleログイン後も画像生成に失敗しました');
        }
      }

      logger.info('プロンプトを入力しました');
      await StealthUtils.randomDelay(300, 600);

      // Enterで送信
      await this.page!.keyboard.press('Enter');
      logger.info('生成を開始しました');

      // 少し待ってからリダイレクトをチェック
      await StealthUtils.randomDelay(3000, 5000);

      // Googleログインにリダイレクトされたかチェック（Enter後のリダイレクト）
      const url = this.page!.url();
      if (url.includes('accounts.google.com')) {
        logger.warn('送信後にGoogleログインが必要です');
        await this.waitForGoogleLogin();

        // 状態を保存
        await this.saveState();

        // 画像生成ページに戻る
        await this.navigateToImageGenerator();

        // もう一度プロンプトを入力して送信
        await StealthUtils.humanType(this.page!, 'textarea', options.prompt);
        await StealthUtils.randomDelay(300, 600);
        await this.page!.keyboard.press('Enter');
        logger.info('再度生成を開始しました');
      }

      // 画像生成を待機
      logger.info('画像生成中（最大3分待機）...');
      const imagePath = await this.waitForImageGeneration();

      if (imagePath) {
        logger.success(`画像生成完了: ${imagePath}`);
        return {
          success: true,
          imagePath,
        };
      }

      throw new Error('画像の生成に失敗しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`画像生成エラー: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 画像生成完了を待機
   */
  private async waitForImageGeneration(): Promise<string | null> {
    if (!this.page) return null;

    const startTime = Date.now();
    const checkedSrcs = new Set<string>();

    while (Date.now() - startTime < IMAGE_GENERATION_TIMEOUT) {
      try {
        // 右側のアセットパネルの画像を優先的に探す
        // アセットパネルは通常、画面右側に表示される大きな画像を含む
        const images = await this.page!.$$('img');

        // 画像をサイズと位置でソート（右側の大きい画像を優先）
        const imageInfos: Array<{img: any, info: any}> = [];
        for (const img of images) {
          try {
            const info = await img.evaluate((el) => ({
              src: el.src || '',
              width: el.naturalWidth || 0,
              height: el.naturalHeight || 0,
              displayWidth: el.clientWidth || 0,
              displayHeight: el.clientHeight || 0,
              left: el.getBoundingClientRect().left || 0,
              isInAssetPanel: el.closest('[class*="asset"]') !== null ||
                             el.closest('[class*="preview"]') !== null ||
                             el.getBoundingClientRect().left > window.innerWidth / 2,
            }));
            imageInfos.push({img, info});
          } catch {
            continue;
          }
        }

        // アセットパネルの画像を優先
        imageInfos.sort((a, b) => {
          if (a.info.isInAssetPanel && !b.info.isInAssetPanel) return -1;
          if (!a.info.isInAssetPanel && b.info.isInAssetPanel) return 1;
          return (b.info.width * b.info.height) - (a.info.width * a.info.height);
        });

        for (const {img, info: imgInfo} of imageInfos) {
          try {
            if (checkedSrcs.has(imgInfo.src)) continue;

            // 小さい画像をスキップ
            if (imgInfo.width < 300 || imgInfo.height < 300) continue;
            if (imgInfo.displayWidth < 150 || imgInfo.displayHeight < 150) continue;
            if (imgInfo.src.includes('avatar') || imgInfo.src.includes('logo')) continue;

            // 生成された画像の可能性が高いもの（アセットパネルの画像を含む）
            const isGenerated = imgInfo.isInAssetPanel ||
                               imgInfo.src.startsWith('blob:') ||
                               imgInfo.src.startsWith('data:image/png') ||
                               imgInfo.src.startsWith('data:image/jpeg') ||
                               (imgInfo.width >= 500 && imgInfo.height >= 500);

            if (isGenerated) {
              const panelInfo = imgInfo.isInAssetPanel ? '(アセットパネル)' : '';
              logger.info(`生成された画像を検出: ${imgInfo.width}x${imgInfo.height} ${panelInfo}`);
              checkedSrcs.add(imgInfo.src);

              await StealthUtils.randomDelay(1500, 2500);

              // 実際の画像データをダウンロード（スクリーンショットではなく）
              const filename = `genspark_${uuidv4()}.png`;
              const outputPath = path.join(PATHS.generated, filename);

              try {
                // 画像のsrcからデータを取得
                let imageBuffer: Buffer | null = null;

                if (imgInfo.src.startsWith('blob:') || imgInfo.src.startsWith('http')) {
                  // blob/HTTP URLの場合、ページコンテキストでfetchしてBase64で取得
                  const base64Data = await this.page!.evaluate(async (src: string) => {
                    try {
                      const response = await fetch(src);
                      const blob = await response.blob();
                      return new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          const result = reader.result as string;
                          // data:image/png;base64,XXXX の形式からBase64部分を抽出
                          const base64 = result.split(',')[1];
                          resolve(base64);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                      });
                    } catch (e) {
                      console.error('Fetch error:', e);
                      return null;
                    }
                  }, imgInfo.src);

                  if (base64Data) {
                    imageBuffer = Buffer.from(base64Data, 'base64');
                  }
                } else if (imgInfo.src.startsWith('data:')) {
                  // data URLの場合、Base64をデコード
                  const base64Data = imgInfo.src.split(',')[1];
                  imageBuffer = Buffer.from(base64Data, 'base64');
                }

                if (imageBuffer && imageBuffer.length > 30000) {
                  await fs.writeFile(outputPath, imageBuffer);
                  logger.info(`画像を保存: ${imageBuffer.length} bytes`);
                  return outputPath;
                } else {
                  logger.debug(`画像サイズ不足: ${imageBuffer?.length || 0} bytes`);
                }
              } catch (downloadError) {
                logger.debug(`画像ダウンロードエラー: ${downloadError}`);
              }

              // フォールバック: スクリーンショットを使用（ただしUI要素が含まれる可能性あり）
              try {
                const boundingBox = await img.boundingBox();
                if (boundingBox && boundingBox.width > 100 && boundingBox.height > 100) {
                  await img.screenshot({ path: outputPath });
                  const stats = await fs.stat(outputPath);
                  if (stats.size > 30000) {
                    logger.info(`フォールバック: スクリーンショットで保存: ${stats.size} bytes`);
                    return outputPath;
                  }
                  await fs.unlink(outputPath).catch(() => {});
                }
              } catch (screenshotError) {
                logger.debug(`スクリーンショットエラー: ${screenshotError}`);
              }
            }
          } catch {
            continue;
          }
        }

        await StealthUtils.randomDelay(2000, 4000);
      } catch (error) {
        logger.debug(`待機中エラー: ${error}`);
        await StealthUtils.randomDelay(2000, 3000);
      }
    }

    // タイムアウト時にデバッグスクリーンショット
    try {
      const debugPath = path.join(PATHS.generated, `debug_timeout_${Date.now()}.png`);
      await this.page!.screenshot({ path: debugPath, fullPage: true });
      logger.info(`デバッグ用スクリーンショット: ${debugPath}`);
    } catch {
      // ignore
    }

    logger.warn('画像生成タイムアウト');
    return null;
  }

  /**
   * カルーセル用の複数画像を生成
   * @param prompts プロンプト配列
   * @param category カテゴリ
   * @param referenceImages 各スライドに対応する参照画像のパス配列（オプション）
   */
  async generateCarouselImages(
    prompts: string[],
    category: CategoryType,
    referenceImages?: string[]
  ): Promise<string[]> {
    const images: string[] = [];

    // ログイン確認
    if (!this.isLoggedIn) {
      const loggedIn = await this.login();
      if (!loggedIn) {
        throw new Error('Gensparkへのログインに失敗しました');
      }
    }

    // 画像生成ページに移動
    const navigated = await this.navigateToImageGenerator();
    if (!navigated) {
      throw new Error('画像生成ページへの移動に失敗しました');
    }

    for (let i = 0; i < prompts.length; i++) {
      logger.info(`画像 ${i + 1}/${prompts.length} を生成中...`);

      // 対応する参照画像を取得
      const referenceImagePath = referenceImages && referenceImages[i] ? referenceImages[i] : undefined;

      const result = await this.generateImage({
        prompt: prompts[i],
        category,
        aspectRatio: '3:4',
        referenceImagePath,
      });

      if (result.success && result.imagePath) {
        images.push(result.imagePath);
      } else {
        logger.warn(`画像 ${i + 1} の生成に失敗、スキップします`);
      }

      // 次の画像の前に少し待機
      if (i < prompts.length - 1) {
        await StealthUtils.randomDelay(2000, 4000);

        // 新しいページに移動して次の生成
        await this.navigateToImageGenerator();
      }
    }

    logger.success(`${images.length}枚の画像を生成`);
    return images;
  }

  /**
   * ブラウザを閉じる
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.saveState();
      await this.context.close();
      this.context = null;
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const gensparkPlaywright = new GensparkPlaywrightGenerator();
