/**
 * HTML/CSSテンプレートを使用した画像合成モジュール
 * Puppeteerでスクリーンショットを撮影して最終画像を生成
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PATHS, IMAGE_SIZES } from './config.js';
import { logger } from './logger.js';
import type { Slide, CompositeOptions } from './types.js';

// ロゴとサンクス画像のパス
const LOGO_PATH = path.join(PATHS.rawPhotos, 'logo.png');
const THANKS_IMAGE_PATH = path.join(PATHS.rawPhotos, 'ifjukuthanks.png');

export class HtmlComposer {
  private browser: Browser | null = null;

  /**
   * ブラウザを起動
   */
  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      logger.info('Puppeteer ブラウザを起動しました');
    }
  }

  /**
   * ブラウザを終了
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Puppeteer ブラウザを終了しました');
    }
  }

  /**
   * テンプレートHTMLを読み込み、変数を置換
   */
  private async loadTemplate(
    templatePath: string,
    variables: Record<string, string>
  ): Promise<string> {
    let html = await fs.readFile(templatePath, 'utf-8');

    // 変数を置換
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      html = html.replaceAll(placeholder, value);
    }

    return html;
  }

  /**
   * 画像ファイルをBase64 Data URLに変換
   */
  private async imageToDataUrl(imagePath: string): Promise<string> {
    try {
      const imageBuffer = await fs.readFile(imagePath);
      const base64 = imageBuffer.toString('base64');
      const mimeType = imagePath.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';
      return `data:${mimeType};base64,${base64}`;
    } catch {
      return '';
    }
  }

  /**
   * HTMLからスクリーンショットを撮影して画像を生成
   */
  async renderToImage(options: CompositeOptions): Promise<string> {
    await this.init();

    const { templatePath, backgroundImagePath, outputPath, variables } = options;

    try {
      // 背景画像をBase64に変換
      const backgroundDataUrl = backgroundImagePath
        ? await this.imageToDataUrl(backgroundImagePath)
        : '';

      // ロゴ画像をBase64に変換
      const logoDataUrl = await this.imageToDataUrl(LOGO_PATH);

      // サンクス画像をBase64に変換
      const thanksDataUrl = await this.imageToDataUrl(THANKS_IMAGE_PATH);

      // テンプレートを読み込み
      const allVariables = {
        ...variables,
        BACKGROUND_IMAGE: backgroundDataUrl,
        LOGO_IMAGE: logoDataUrl,
        THANKS_IMAGE: thanksDataUrl,
      };
      const html = await this.loadTemplate(templatePath, allVariables);

      // ページを作成
      const page = await this.browser!.newPage();

      // ビューポートサイズを設定
      await page.setViewport({
        width: IMAGE_SIZES.carousel.width,
        height: IMAGE_SIZES.carousel.height,
        deviceScaleFactor: 1,
      });

      // HTMLをセット
      await page.setContent(html, {
        waitUntil: 'networkidle0',
      });

      // フォントの読み込みを待つ
      await page.evaluate(() => document.fonts.ready);
      await this.delay(500); // 追加の待機

      // スクリーンショットを撮影
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await page.screenshot({
        path: outputPath,
        type: 'jpeg',
        quality: 95,
      });

      await page.close();

      logger.success(`画像を生成しました: ${outputPath}`);
      return outputPath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`画像合成エラー: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * カルーセル表紙を生成
   */
  async renderCoverSlide(
    slide: Slide,
    backgroundImagePath: string,
    outputPath: string
  ): Promise<string> {
    const templatePath = path.join(PATHS.templates, 'carousel-cover.html');

    return this.renderToImage({
      templatePath,
      backgroundImagePath,
      outputPath,
      variables: {
        HEADLINE: slide.headline,
        SUBTEXT: slide.subtext || '',
      },
    });
  }

  /**
   * カルーセルコンテンツスライドを生成
   */
  async renderContentSlide(
    slide: Slide,
    backgroundImagePath: string,
    outputPath: string,
    slideIndex: number,
    totalSlides: number
  ): Promise<string> {
    const templatePath = path.join(PATHS.templates, 'carousel-content.html');

    // ポイントリストをHTML化
    const pointsHtml = (slide.points || [])
      .map(
        (point) => `
        <div class="point-item">
          <div class="point-icon">
            <span class="checkmark">✓</span>
          </div>
          <p class="point-text">${this.escapeHtml(point)}</p>
        </div>
      `
      )
      .join('\n');

    // スライドインジケーターを生成
    const indicatorsHtml = Array(totalSlides)
      .fill(0)
      .map(
        (_, i) =>
          `<div class="indicator-dot${i === slideIndex ? ' active' : ''}"></div>`
      )
      .join('\n');

    return this.renderToImage({
      templatePath,
      backgroundImagePath,
      outputPath,
      variables: {
        HEADLINE: slide.headline,
        POINTS: pointsHtml,
        SLIDE_INDICATORS: indicatorsHtml,
      },
    });
  }

  /**
   * カルーセルサンクススライドを生成
   * ifjukuthanks.pngをそのまま表示
   */
  async renderThanksSlide(
    slide: Slide,
    backgroundImagePath: string,
    outputPath: string
  ): Promise<string> {
    const templatePath = path.join(PATHS.templates, 'carousel-thanks.html');

    // サンクス画像を直接使用（背景画像は不要）
    return this.renderToImage({
      templatePath,
      backgroundImagePath: '', // 使用しない
      outputPath,
      variables: {},
    });
  }

  /**
   * トピックからカルーセル全スライドを生成
   */
  async generateCarouselSlides(
    slides: Slide[],
    backgroundImages: string[],
    topicId: string
  ): Promise<string[]> {
    const outputPaths: string[] = [];
    const outputDir = path.join(PATHS.generated, topicId);

    await fs.mkdir(outputDir, { recursive: true });

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const backgroundImage = backgroundImages[i] || backgroundImages[0];
      const outputPath = path.join(outputDir, `slide_${i + 1}.jpg`);

      let result: string;

      switch (slide.type) {
        case 'cover':
          result = await this.renderCoverSlide(slide, backgroundImage, outputPath);
          break;
        case 'content':
          result = await this.renderContentSlide(
            slide,
            backgroundImage,
            outputPath,
            i,
            slides.length
          );
          break;
        case 'thanks':
          result = await this.renderThanksSlide(slide, backgroundImage, outputPath);
          break;
        default:
          result = await this.renderContentSlide(
            slide,
            backgroundImage,
            outputPath,
            i,
            slides.length
          );
      }

      outputPaths.push(result);
      logger.info(`スライド ${i + 1}/${slides.length} を生成しました`);
    }

    return outputPaths;
  }

  /**
   * HTMLエスケープ
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const htmlComposer = new HtmlComposer();
