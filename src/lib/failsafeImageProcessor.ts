/**
 * フェイルセーフ画像処理モジュール
 * 品質チェックに失敗した画像を修正するための最終手段
 */
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

export interface FailsafeOptions {
  imagePath: string;
  textToOverlay?: string[];
  trimLogo?: boolean;
  outputPath?: string;
}

export interface FailsafeResult {
  success: boolean;
  outputPath: string;
  modifications: string[];
}

export class FailsafeImageProcessor {
  /**
   * 画像を修正（ロゴ除去、テキストオーバーレイ）
   */
  async processImage(options: FailsafeOptions): Promise<FailsafeResult> {
    const { imagePath, textToOverlay = [], trimLogo = false } = options;
    const modifications: string[] = [];

    try {
      let image = sharp(imagePath);
      const metadata = await image.metadata();
      const width = metadata.width || 1080;
      const height = metadata.height || 1350;

      // 1. ロゴ除去（上部をトリミング）
      if (trimLogo) {
        const trimHeight = Math.floor(height * 0.08); // 上部8%をカット
        image = image.extract({
          left: 0,
          top: trimHeight,
          width: width,
          height: height - trimHeight,
        });
        // リサイズして元のサイズに戻す
        image = image.resize(width, height, { fit: 'fill' });
        modifications.push('ロゴ領域を除去');
      }

      // 2. テキストオーバーレイ
      if (textToOverlay.length > 0) {
        const svgText = this.createTextOverlaySVG(textToOverlay, width, height);
        image = image.composite([
          {
            input: Buffer.from(svgText),
            gravity: 'center',
          },
        ]);
        modifications.push('テキストをオーバーレイ');
      }

      // 出力パスを決定
      const outputPath =
        options.outputPath ||
        imagePath.replace(/(\.[^.]+)$/, '_fixed$1');

      // 保存
      await image.jpeg({ quality: 95 }).toFile(outputPath);

      logger.info(`フェイルセーフ処理完了: ${outputPath}`);
      return {
        success: true,
        outputPath,
        modifications,
      };
    } catch (error) {
      logger.error(`フェイルセーフ処理エラー: ${error}`);
      return {
        success: false,
        outputPath: imagePath,
        modifications: [],
      };
    }
  }

  /**
   * テキストの長さに応じてフォントサイズを計算（見切れ防止）
   */
  private calculateFontSize(text: string, maxWidth: number, baseFontSize: number): number {
    // 日本語文字は約1文字がフォントサイズの幅と同等と仮定
    // 英数字は約0.6文字分
    const charCount = text.split('').reduce((count, char) => {
      // 日本語判定（ひらがな、カタカナ、漢字）
      if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(char)) {
        return count + 1;
      }
      return count + 0.6;
    }, 0);

    // テキスト幅が画像幅の85%を超えないようにフォントサイズを調整
    const targetWidth = maxWidth * 0.85;
    const estimatedWidth = charCount * baseFontSize;

    if (estimatedWidth > targetWidth) {
      return Math.floor((targetWidth / charCount) * 0.95);
    }
    return baseFontSize;
  }

  /**
   * テキストオーバーレイ用SVGを生成（見切れ防止機能付き）
   */
  private createTextOverlaySVG(
    texts: string[],
    width: number,
    height: number
  ): string {
    const mainText = texts[0] || '';
    const subTexts = texts.slice(1);

    // ベースのフォントサイズ
    const baseMainFontSize = Math.min(width / 10, 100);
    const baseSubFontSize = Math.min(width / 15, 60);

    // テキスト要素を生成
    let textElements = '';

    // メインテキスト（上部に配置、黒い縁取り付き白文字）
    if (mainText) {
      // テキストの長さに応じてフォントサイズを調整
      const mainFontSize = this.calculateFontSize(mainText, width, baseMainFontSize);
      const mainY = height * 0.15;
      textElements += `
        <text x="${width / 2}" y="${mainY}"
          font-family="Hiragino Sans, Yu Gothic, sans-serif"
          font-size="${mainFontSize}"
          font-weight="bold"
          fill="white"
          stroke="black"
          stroke-width="3"
          text-anchor="middle"
          dominant-baseline="middle"
          style="filter: drop-shadow(3px 3px 6px rgba(0,0,0,0.8))">
          ${this.escapeXml(mainText)}
        </text>
      `;
    }

    // サブテキスト（下部に配置）
    subTexts.forEach((text, index) => {
      // テキストの長さに応じてフォントサイズを調整
      const subFontSize = this.calculateFontSize(text, width, baseSubFontSize);
      const subY = height * 0.8 + index * (subFontSize + 10);
      textElements += `
        <text x="${width / 2}" y="${subY}"
          font-family="Hiragino Sans, Yu Gothic, sans-serif"
          font-size="${subFontSize}"
          font-weight="bold"
          fill="white"
          stroke="black"
          stroke-width="2"
          text-anchor="middle"
          dominant-baseline="middle"
          style="filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.8))">
          ${this.escapeXml(text)}
        </text>
      `;
    });

    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        ${textElements}
      </svg>
    `;
  }

  /**
   * XML用エスケープ
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 画像のロゴ部分を検出してトリミング
   */
  async detectAndTrimLogo(imagePath: string): Promise<string> {
    try {
      const image = sharp(imagePath);
      const metadata = await image.metadata();
      const width = metadata.width || 1080;
      const height = metadata.height || 1350;

      // 上部10%をカット（ロゴがある可能性が高い領域）
      const trimHeight = Math.floor(height * 0.10);
      const outputPath = imagePath.replace(/(\.[^.]+)$/, '_trimmed$1');

      await image
        .extract({
          left: 0,
          top: trimHeight,
          width: width,
          height: height - trimHeight,
        })
        .resize(width, height, { fit: 'fill' })
        .jpeg({ quality: 95 })
        .toFile(outputPath);

      logger.info(`ロゴ領域をトリミング: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.error(`トリミングエラー: ${error}`);
      return imagePath;
    }
  }

  /**
   * 複数画像をバッチ処理
   */
  async batchProcess(
    imagePaths: string[],
    textsBySlide: string[][]
  ): Promise<string[]> {
    const results: string[] = [];

    for (let i = 0; i < imagePaths.length; i++) {
      const result = await this.processImage({
        imagePath: imagePaths[i],
        textToOverlay: textsBySlide[i] || [],
        trimLogo: true,
      });
      results.push(result.outputPath);
    }

    return results;
  }
}

export const failsafeImageProcessor = new FailsafeImageProcessor();
