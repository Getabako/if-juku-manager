/**
 * Genspark 画像生成モジュール
 * Puppeteerでブラウザを操作してGensparkで画像を生成
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PATHS, IMAGE_SIZES } from './config.js';
import { logger } from './logger.js';
import type { GeminiImageResponse, CategoryType } from './types.js';
import type { Character, CharacterRole } from './characterManager.js';

// Genspark設定
const GENSPARK_URL = 'https://www.genspark.ai/';
const GENSPARK_IMAGE_URL = 'https://www.genspark.ai/agents?type=image_generation_agent';
const SESSION_FILE = path.join(PATHS.data, 'genspark_session.json');
const DOWNLOAD_DIR = path.join(PATHS.generated, 'genspark_downloads');
const USER_DATA_DIR = path.join(PATHS.data, 'genspark_browser_profile');

// 使用するモデル
const IMAGE_MODEL = 'Nano Banana Pro';

// タイムアウト設定
const NAVIGATION_TIMEOUT = 60000;
const IMAGE_GENERATION_TIMEOUT = 180000; // 3分

// アップロード済みアセットのキャッシュ
const uploadedAssets: Map<string, boolean> = new Map();

export interface GensparkImageOptions {
  prompt: string;
  category?: CategoryType;
  style?: string;
  aspectRatio?: '1:1' | '3:4' | '4:5' | '9:16' | '16:9';
  characterAssets?: Character[]; // 使用するキャラクターアセット
}

export class GensparkImageGenerator {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isLoggedIn: boolean = false;
  private uploadedAssetNames: Set<string> = new Set();

  /**
   * ブラウザを起動（ヘッドレスモードは設定可能）
   */
  async init(headless: boolean = false): Promise<void> {
    if (this.browser) {
      return;
    }

    // ダウンロードディレクトリを作成
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
    // ユーザーデータディレクトリを作成
    await fs.mkdir(USER_DATA_DIR, { recursive: true });

    this.browser = await puppeteer.launch({
      headless,
      // userDataDirを使用してブラウザプロファイルを永続化
      // これによりlocalStorage, sessionStorage, IndexedDB, cookiesが全て保持される
      userDataDir: USER_DATA_DIR,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
    });

    this.page = await this.browser.newPage();

    // ダウンロード先を設定
    const client = await this.page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR,
    });

    logger.info('Genspark ブラウザを起動しました');
  }

  /**
   * セッション（Cookie）を保存
   */
  async saveSession(): Promise<void> {
    if (!this.page) return;

    try {
      const cookies = await this.page.cookies();
      await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
      await fs.writeFile(SESSION_FILE, JSON.stringify(cookies, null, 2));
      logger.debug('Gensparkセッションを保存しました');
    } catch (error) {
      logger.warn('セッションの保存に失敗しました');
    }
  }

  /**
   * セッション（Cookie）を復元
   */
  async restoreSession(): Promise<void> {
    if (!this.page) return;

    try {
      const sessionData = await fs.readFile(SESSION_FILE, 'utf-8');
      const cookies = JSON.parse(sessionData);
      await this.page.setCookie(...cookies);
      logger.debug('Gensparkセッションを復元しました');
    } catch {
      logger.debug('保存されたセッションがありません');
    }
  }

  /**
   * Gensparkにログイン（手動操作を待機）
   */
  async login(): Promise<boolean> {
    if (!this.page) {
      await this.init(false); // ログイン時はheadlessをオフ
    }

    try {
      logger.info('Gensparkにアクセス中...');
      await this.page!.goto(GENSPARK_URL, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      });

      // ログイン状態をチェック
      let isLoggedIn = await this.checkLoginStatus();

      if (!isLoggedIn) {
        // ログインページに移動
        logger.info('ログインが必要です。ブラウザでログインしてください...');
        logger.info('ログインが完了したら、自動的に検出されます');

        // ユーザーがログインするのを待つ
        await this.waitForManualLogin();
      }

      // 画像生成ページでもログインが有効か確認
      logger.info('画像生成ページでセッションを確認中...');
      await this.page!.goto(GENSPARK_IMAGE_URL, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      });
      await this.delay(3000);

      // 画像生成ページでログインページにリダイレクトされていないか確認
      const onLoginPageAfter = await this.isOnLoginPage();
      if (onLoginPageAfter) {
        logger.warn('画像生成機能にはログインが必要です');
        logger.info('ブラウザでログインしてください...');

        // 手動ログインを待つ
        await this.waitForManualLogin();

        // 再度画像生成ページに移動
        await this.page!.goto(GENSPARK_IMAGE_URL, {
          waitUntil: 'networkidle2',
          timeout: NAVIGATION_TIMEOUT,
        });
        await this.delay(3000);

        // 再度チェック
        const stillOnLogin = await this.isOnLoginPage();
        if (stillOnLogin) {
          logger.error('ログインに失敗しました');
          return false;
        }
      }

      // 入力欄が表示されることを確認
      try {
        await this.page!.waitForSelector('textarea, [placeholder*="想像"], [placeholder*="シーン"]', {
          timeout: 10000,
        });
        logger.success('画像生成ページへのアクセスを確認しました');
      } catch {
        logger.error('画像生成ページにアクセスできません');
        return false;
      }

      // セッションを保存
      await this.saveSession();
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
   * ログインページにいるかどうかをチェック
   */
  private async isOnLoginPage(): Promise<boolean> {
    if (!this.page) return false;

    try {
      const currentUrl = this.page.url();
      // URLでログインページを検出
      if (currentUrl.includes('/login') || currentUrl.includes('/signin') || currentUrl.includes('accounts.google.com')) {
        return true;
      }

      // Gensparkの画像生成ページにいるかチェック（ログインしていればtextareaがある）
      const textarea = await this.page.$('textarea');
      if (textarea) {
        // textareaがあればログイン済み
        return false;
      }

      // ログインページの特徴的な要素を検出
      // "Genspark AI Workspace"という見出しがあり、かつログインボタンがある
      const workspaceTitle = await this.page.$('text=Genspark AI Workspace');
      const loginWithEmail = await this.page.$('text=Login with email');

      if (workspaceTitle && loginWithEmail) {
        logger.debug('ログインページを検出（Workspace + Login with email）');
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * ログイン状態をチェック
   */
  private async checkLoginStatus(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // まずログインページにいるかどうかをチェック
      const onLoginPage = await this.isOnLoginPage();
      if (onLoginPage) {
        logger.debug('ログインページにいます - ログインが必要');
        return false;
      }

      // ログイン後に表示される要素をチェック
      // Gensparkのダッシュボードに表示される要素を探す
      const selectors = [
        'text=ワークスペース',
        'text=ホーム',
        'text=AI画像',
        'text=AIドライブ',
        '[class*="workspace"]',
        '[class*="dashboard"]',
        'text=Credits',
        'textarea[placeholder]', // 入力欄がある = ログイン済み
      ];

      for (const selector of selectors) {
        const element = await this.page.$(selector);
        if (element) {
          logger.debug(`ログイン検出: ${selector}`);
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 手動ログインを待機
   */
  private async waitForManualLogin(): Promise<void> {
    return new Promise((resolve) => {
      const checkLogin = async () => {
        const isLoggedIn = await this.checkLoginStatus();
        if (isLoggedIn) {
          resolve();
        } else {
          setTimeout(checkLogin, 2000);
        }
      };

      // 5秒後からチェック開始
      setTimeout(checkLogin, 5000);

      // 最大5分待機
      setTimeout(() => {
        resolve();
      }, 300000);
    });
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

      // AI画像ページに直接移動
      await this.page!.goto(GENSPARK_IMAGE_URL, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      });

      // ページの読み込みを待つ
      await this.delay(3000);

      // ログインページにリダイレクトされたかチェック
      const onLoginPage = await this.isOnLoginPage();
      if (onLoginPage) {
        logger.warn('セッションが期限切れです。再ログインが必要です。');
        // セッションファイルを削除
        try {
          await fs.unlink(SESSION_FILE);
          logger.info('古いセッションを削除しました');
        } catch {
          // ignore
        }
        this.isLoggedIn = false;
        throw new Error('セッションが期限切れです。--setupオプションで再ログインしてください。');
      }

      // 入力欄が表示されるまで待つ
      await this.page!.waitForSelector('textarea, [placeholder*="想像"], [placeholder*="シーン"]', {
        timeout: 15000,
      });

      logger.info('AI画像ページに到達しました');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`ページ移動エラー: ${errorMessage}`);
      return false;
    }
  }

  /**
   * キャラクターアセットをアップロード
   */
  async uploadCharacterAsset(character: Character): Promise<boolean> {
    if (!this.page) {
      await this.init();
    }

    // 既にアップロード済みならスキップ
    if (this.uploadedAssetNames.has(character.name)) {
      logger.info(`アセット "${character.name}" は既にアップロード済みです`);
      return true;
    }

    try {
      logger.info(`キャラクターアセット "${character.name}" をアップロード中...`);

      // 画像生成ページに移動
      await this.navigateToImageGenerator();
      await this.delay(2000);

      // アセットボタンを探してクリック
      const assetButton = await this.page!.$('text=アセット');
      if (!assetButton) {
        // 別のセレクタを試す
        const altButton = await this.page!.$('[class*="asset"], button:has-text("Assets")');
        if (altButton) {
          await altButton.click();
        } else {
          logger.warn('アセットボタンが見つかりません');
          return false;
        }
      } else {
        await assetButton.click();
      }
      await this.delay(1500);

      // アップロードボタンまたはプラスボタンを探す
      const uploadSelectors = [
        'text=アップロード',
        'text=Upload',
        '[class*="upload"]',
        'button[class*="add"]',
        '[class*="plus"]',
      ];

      let uploadButton = null;
      for (const selector of uploadSelectors) {
        uploadButton = await this.page!.$(selector);
        if (uploadButton) break;
      }

      if (uploadButton) {
        await uploadButton.click();
        await this.delay(1000);
      }

      // ファイル入力を探す
      const fileInput = await this.page!.$('input[type="file"]');
      if (fileInput) {
        // キャラクター画像をアップロード
        await fileInput.uploadFile(character.imagePath);
        logger.info('キャラクター画像をアップロードしました');
        await this.delay(3000);

        // アセット名を入力（あれば）
        const nameInput = await this.page!.$('input[placeholder*="名前"], input[name*="name"]');
        if (nameInput) {
          await nameInput.type(character.name);
        }

        // 保存/確認ボタンをクリック
        const saveButton = await this.page!.$('text=保存, text=Save, text=確認, text=OK, button[type="submit"]');
        if (saveButton) {
          await saveButton.click();
          await this.delay(2000);
        }

        this.uploadedAssetNames.add(character.name);
        logger.success(`アセット "${character.name}" をアップロード完了`);
        return true;
      }

      logger.warn('ファイル入力が見つかりません');
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`アセットアップロードエラー: ${errorMessage}`);
      return false;
    }
  }

  /**
   * 複数のキャラクターアセットをアップロード
   */
  async uploadCharacterAssets(characters: Character[]): Promise<boolean> {
    for (const character of characters) {
      await this.uploadCharacterAsset(character);
      await this.delay(2000);
    }
    return true;
  }

  /**
   * アスペクト比を設定（3:4 = Instagram用）
   */
  async setAspectRatio(): Promise<void> {
    if (!this.page) return;

    try {
      // 設定ボタンをクリック
      const settingsButton = await this.page.$('text=設定');
      if (settingsButton) {
        await settingsButton.click();
        await this.delay(1000);

        // 3:4 アスペクト比を選択
        const aspectRatio = await this.page.$('text=3:4');
        if (aspectRatio) {
          await aspectRatio.click();
          logger.info('アスペクト比を3:4に設定しました');
          await this.delay(500);

          // 設定を閉じる（ページの他の場所をクリック）
          await this.page.keyboard.press('Escape');
        }
      }
    } catch (error) {
      logger.debug('アスペクト比の設定をスキップ');
    }
  }

  /**
   * NanoBananaProモデルを選択
   */
  async selectModel(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // モデル選択ドロップダウンを探してクリック
      const modelSelector = await this.page.$('[class*="model"], [class*="select"], button:has-text("Model"), [data-testid*="model"]');
      if (modelSelector) {
        await modelSelector.click();
        await this.delay(1000);

        // NanoBananaProを選択
        const modelOption = await this.page.$(`text=${IMAGE_MODEL}`);
        if (modelOption) {
          await modelOption.click();
          await this.delay(500);
          logger.info(`モデル ${IMAGE_MODEL} を選択しました`);
          return true;
        }
      }

      // モデル選択がない場合はスキップ（デフォルトモデルを使用）
      logger.debug('モデル選択をスキップ');
      return true;
    } catch (error) {
      logger.debug('モデル選択に失敗、デフォルトを使用');
      return true;
    }
  }

  /**
   * ログインポップアップをチェックして閉じる
   */
  private async checkAndCloseLoginPopup(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Googleログインポップアップを検出
      const loginIndicators = [
        'text=Google でログイン',
        'text=Sign in with Google',
        'text=メールアドレスまたは電話番号',
        'text=Enter your email',
        '[data-identifier]',
        'input[type="email"]',
      ];

      for (const selector of loginIndicators) {
        const element = await this.page.$(selector);
        if (element) {
          logger.warn('ログインポップアップを検出しました');

          // ESCキーで閉じてみる
          await this.page.keyboard.press('Escape');
          await this.delay(1000);

          // ポップアップの外側をクリック
          await this.page.mouse.click(50, 50);
          await this.delay(1000);

          // まだポップアップがあるか確認
          const stillThere = await this.page.$(selector);
          if (stillThere) {
            logger.error('ログインポップアップを閉じられませんでした。手動ログインが必要です。');
            return true;
          }
          logger.info('ログインポップアップを閉じました');
          return false;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 正しいプロンプト入力欄かどうかを確認
   */
  private async isValidPromptInput(element: any): Promise<boolean> {
    if (!element) return false;

    try {
      const tagName = await element.evaluate((el: Element) => el.tagName.toLowerCase());
      const placeholder = await element.evaluate((el: Element) => el.getAttribute('placeholder') || '');
      const type = await element.evaluate((el: Element) => el.getAttribute('type') || '');
      const name = await element.evaluate((el: Element) => el.getAttribute('name') || '');

      // ログイン関連の入力欄を除外
      const loginPatterns = ['email', 'password', 'login', 'signin', 'username', 'phone', 'メール', '電話'];
      const combinedText = `${placeholder} ${type} ${name}`.toLowerCase();

      for (const pattern of loginPatterns) {
        if (combinedText.includes(pattern)) {
          logger.debug(`ログイン関連の入力欄を除外: ${placeholder}`);
          return false;
        }
      }

      // textareaまたはGenspark特有の入力欄であることを確認
      if (tagName === 'textarea') {
        return true;
      }

      // Gensparkの画像生成プロンプト入力欄の特徴をチェック
      if (placeholder.includes('想像') || placeholder.includes('シーン') || placeholder.includes('説明')) {
        return true;
      }

      return false;
    } catch {
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

      // 画像生成ページに移動（まだいない場合）
      const currentUrl = this.page!.url();
      if (!currentUrl.includes('image_generation_agent')) {
        await this.navigateToImageGenerator();
      }

      // ページが完全に読み込まれるまで待つ
      await this.delay(2000);

      // ログインポップアップをチェック
      const hasLoginPopup = await this.checkAndCloseLoginPopup();
      if (hasLoginPopup) {
        throw new Error('ログインが必要です。--setupオプションで再ログインしてください。');
      }

      // 初回のみアスペクト比を設定
      if (options.aspectRatio === '4:5' || options.aspectRatio === '3:4') {
        await this.setAspectRatio();
      }

      // プロンプト入力欄を探す（Gensparkの実際のUI用）
      // 優先順位: Genspark特有のtextarea > 一般的なtextarea
      const inputSelectors = [
        'textarea[placeholder*="想像"]',
        'textarea[placeholder*="シーン"]',
        'textarea[placeholder*="説明"]',
      ];

      let promptInput = null;
      for (const selector of inputSelectors) {
        try {
          promptInput = await this.page!.$(selector);
          if (promptInput && await this.isValidPromptInput(promptInput)) {
            logger.debug(`入力欄を発見: ${selector}`);
            break;
          }
          promptInput = null;
        } catch {
          continue;
        }
      }

      // Genspark特有のセレクタで見つからない場合、一般的なtextareaを探す
      if (!promptInput) {
        const textareas = await this.page!.$$('textarea');
        for (const textarea of textareas) {
          if (await this.isValidPromptInput(textarea)) {
            promptInput = textarea;
            logger.debug('一般的なtextareaを使用');
            break;
          }
        }
      }

      if (!promptInput) {
        // 最終手段: waitForSelectorを使用
        try {
          promptInput = await this.page!.waitForSelector('textarea[placeholder*="想像"], textarea[placeholder*="シーン"]', { timeout: 15000 });
        } catch {
          throw new Error('プロンプト入力欄が見つかりません。ページを確認してください。');
        }
      }

      if (!promptInput) {
        throw new Error('プロンプト入力欄が見つかりません');
      }

      // 入力前に再度ログインポップアップをチェック
      const stillHasPopup = await this.checkAndCloseLoginPopup();
      if (stillHasPopup) {
        throw new Error('ログインポップアップが閉じられません');
      }

      // 現在のURLをチェック - Googleログインページなら中止
      const urlBeforeInput = this.page!.url();
      if (urlBeforeInput.includes('accounts.google.com') || urlBeforeInput.includes('login')) {
        throw new Error('ログインページにリダイレクトされました。--setupで再ログインしてください。');
      }

      // 入力欄をクリックしてフォーカス
      await promptInput.click();
      await this.delay(300);

      // クリック後にURLが変わっていないか確認
      const urlAfterClick = this.page!.url();
      if (urlAfterClick.includes('accounts.google.com') || urlAfterClick.includes('login')) {
        throw new Error('クリック後にログインページにリダイレクトされました。');
      }

      // 既存テキストをクリア
      await this.page!.keyboard.down('Meta');
      await this.page!.keyboard.press('a');
      await this.page!.keyboard.up('Meta');
      await this.page!.keyboard.press('Backspace');

      // プロンプトを入力 (より安全な方法で入力)
      // ページが正しいことを確認しながら入力
      const urlBeforeType = this.page!.url();
      if (!urlBeforeType.includes('genspark.ai')) {
        throw new Error('Gensparkページから離脱しました。');
      }

      // 入力欄が有効かどうか再確認
      const isStillValid = await this.isValidPromptInput(promptInput);
      if (!isStillValid) {
        throw new Error('入力欄が無効になりました。ページをリロードしてください。');
      }

      await promptInput.type(options.prompt, { delay: 5 });
      logger.info('プロンプトを入力しました');

      await this.delay(500);

      // 送信前にURLを再確認
      const urlBeforeSend = this.page!.url();
      if (!urlBeforeSend.includes('genspark.ai')) {
        throw new Error('送信前にGensparkページから離脱しました。');
      }

      // Enterキーで送信（Gensparkは矢印ボタンまたはEnterで送信）
      await this.page!.keyboard.press('Enter');
      logger.info('生成を開始しました');

      // 画像生成を待つ
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
   * 画像生成完了を待機してダウンロード
   */
  private async waitForImageGeneration(): Promise<string | null> {
    if (!this.page) return null;

    const startTime = Date.now();
    let lastCheckedSrcs = new Set<string>();

    while (Date.now() - startTime < IMAGE_GENERATION_TIMEOUT) {
      try {
        // 生成された画像を探す - 複数の方法で検出
        // 1. 大きな画像要素を探す
        const imgElements = await this.page!.$$('img');

        for (const img of imgElements) {
          try {
            const imgInfo = await img.evaluate((el) => ({
              src: el.src || '',
              width: el.naturalWidth || 0,
              height: el.naturalHeight || 0,
              displayWidth: el.clientWidth || 0,
              displayHeight: el.clientHeight || 0,
              alt: el.alt || '',
              className: el.className || '',
              parentClasses: el.parentElement?.className || '',
            }));

            // 既にチェック済みの画像をスキップ
            if (lastCheckedSrcs.has(imgInfo.src)) continue;

            // 小さい画像やアイコンをスキップ
            if (imgInfo.width < 300 || imgInfo.height < 300) continue;
            if (imgInfo.displayWidth < 200 || imgInfo.displayHeight < 200) continue;
            if (imgInfo.src.includes('avatar') || imgInfo.src.includes('logo') || imgInfo.src.includes('icon')) continue;
            if (imgInfo.src.includes('data:image/svg')) continue;

            // 生成された画像の可能性が高いものを検出
            // - blob: URL (ローカル生成)
            // - data: URL (base64エンコード)
            // - 大きなサイズの画像
            const isGenerated = imgInfo.src.startsWith('blob:') ||
                               imgInfo.src.startsWith('data:image/png') ||
                               imgInfo.src.startsWith('data:image/jpeg') ||
                               imgInfo.src.includes('generated') ||
                               imgInfo.className.includes('generated') ||
                               imgInfo.parentClasses.includes('result') ||
                               (imgInfo.width >= 500 && imgInfo.height >= 500);

            if (isGenerated) {
              logger.info(`生成された画像を検出: ${imgInfo.width}x${imgInfo.height}`);
              lastCheckedSrcs.add(imgInfo.src);

              // 画像が完全に読み込まれるまで少し待つ
              await this.delay(2000);

              // 画像を直接スクリーンショット
              const filename = `genspark_${uuidv4()}.png`;
              const outputPath = path.join(PATHS.generated, filename);

              try {
                // 画像要素のスクリーンショットを撮る
                const boundingBox = await img.boundingBox();
                if (boundingBox && boundingBox.width > 100 && boundingBox.height > 100) {
                  await img.screenshot({ path: outputPath });

                  // ファイルサイズを確認
                  const stats = await fs.stat(outputPath);
                  if (stats.size > 30000) { // 30KB以上
                    logger.info(`画像を保存: ${stats.size} bytes`);
                    return outputPath;
                  }
                  await fs.unlink(outputPath).catch(() => {});
                  logger.debug(`画像が小さすぎます: ${stats.size} bytes`);
                }
              } catch (ssError) {
                logger.debug(`スクリーンショット失敗、URLからダウンロード試行`);

                // スクリーンショットに失敗した場合、URLからダウンロードを試みる
                if (imgInfo.src.startsWith('http')) {
                  const downloaded = await this.downloadImageWithValidation(imgInfo.src);
                  if (downloaded) return downloaded;
                }
              }
            }
          } catch {
            continue;
          }
        }

        // 2. canvasからも画像を探す
        const canvasElements = await this.page!.$$('canvas');
        for (const canvas of canvasElements) {
          try {
            const canvasInfo = await canvas.evaluate((el) => ({
              width: el.width,
              height: el.height,
            }));

            if (canvasInfo.width >= 400 && canvasInfo.height >= 400) {
              logger.info(`大きなcanvasを検出: ${canvasInfo.width}x${canvasInfo.height}`);

              const filename = `genspark_${uuidv4()}.png`;
              const outputPath = path.join(PATHS.generated, filename);

              await canvas.screenshot({ path: outputPath });
              const stats = await fs.stat(outputPath);
              if (stats.size > 30000) {
                logger.info(`canvasから画像を保存: ${stats.size} bytes`);
                return outputPath;
              }
              await fs.unlink(outputPath).catch(() => {});
            }
          } catch {
            continue;
          }
        }

        // 3秒待ってから再チェック
        await this.delay(3000);
      } catch (error) {
        logger.debug(`待機中エラー: ${error}`);
        await this.delay(3000);
      }
    }

    // タイムアウト時にデバッグ用スクリーンショットを保存
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
   * 画像をダウンロードして検証
   */
  private async downloadImageWithValidation(url: string): Promise<string | null> {
    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();

      // 最小サイズチェック
      if (buffer.byteLength < 30000) {
        logger.debug(`ダウンロードした画像が小さすぎます: ${buffer.byteLength} bytes`);
        return null;
      }

      const filename = `genspark_${uuidv4()}.png`;
      const outputPath = path.join(PATHS.generated, filename);
      await fs.writeFile(outputPath, Buffer.from(buffer));

      logger.info(`画像をダウンロード: ${buffer.byteLength} bytes`);
      return outputPath;
    } catch (error) {
      logger.debug(`ダウンロード失敗: ${error}`);
      return null;
    }
  }


  /**
   * 最新のダウンロードファイルを取得
   */
  private async findLatestDownload(): Promise<string | null> {
    try {
      const files = await fs.readdir(DOWNLOAD_DIR);
      const imageFiles = files.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));

      if (imageFiles.length === 0) {
        return null;
      }

      // 最新のファイルを取得
      const filePaths = imageFiles.map((f) => path.join(DOWNLOAD_DIR, f));
      const stats = await Promise.all(
        filePaths.map(async (p) => ({
          path: p,
          mtime: (await fs.stat(p)).mtime,
        }))
      );

      stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // 生成済みフォルダに移動
      const latestFile = stats[0].path;
      const newPath = path.join(PATHS.generated, `genspark_${uuidv4()}${path.extname(latestFile)}`);
      await fs.rename(latestFile, newPath);

      return newPath;
    } catch {
      return null;
    }
  }

  /**
   * カルーセル用の4枚の画像を生成（表紙1 + 内容3）
   */
  async generateCarouselImages(
    prompts: string[],
    category: CategoryType
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
    await this.navigateToImageGenerator();

    // 4枚の画像を生成
    for (let i = 0; i < Math.min(prompts.length, 4); i++) {
      logger.info(`画像 ${i + 1}/4 を生成中...`);

      const result = await this.generateImage({
        prompt: prompts[i],
        category,
        aspectRatio: '4:5', // Instagram用
      });

      if (result.success && result.imagePath) {
        images.push(result.imagePath);
      } else {
        logger.warn(`画像 ${i + 1} の生成に失敗、スキップします`);
      }

      // レート制限対策
      await this.delay(3000);
    }

    return images;
  }

  /**
   * ブラウザを終了
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.saveSession();
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.info('Genspark ブラウザを終了しました');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const gensparkGenerator = new GensparkImageGenerator();
