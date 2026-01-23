/**
 * キャラクター合成モジュール
 * 生成された背景画像にキャラクター（塾長・塾頭）を合成
 */
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import {
  getCharacter,
  getAllCharacters,
  assignCharactersToSlides,
  type Character,
  type CharacterRole,
} from './characterManager.js';

// キャラクター画像のサイズ設定
const CHARACTER_SIZE = {
  width: 350,  // キャラクター画像の幅
  height: 500, // キャラクター画像の高さ
};

// キャラクターの配置設定
const CHARACTER_POSITION = {
  bottom: 50,  // 下からの距離
  right: 30,   // 右からの距離（右配置時）
  left: 30,    // 左からの距離（左配置時）
};

export interface CompositeOptions {
  backgroundPath: string;
  outputPath: string;
  characterRole: CharacterRole;
  position?: 'left' | 'right';
  useAngleVersion?: boolean;
}

export class CharacterCompositor {
  private characters: Map<CharacterRole, Character> | null = null;

  /**
   * キャラクター情報を読み込み
   */
  async init(): Promise<void> {
    if (!this.characters) {
      this.characters = await getAllCharacters();
      logger.info(`${this.characters.size}人のキャラクターを読み込みました`);
    }
  }

  /**
   * キャラクター画像の背景を透過処理
   * グレー背景（#c0c0c0〜#f0f0f0付近）を透過に変換
   */
  private async removeGrayBackground(inputBuffer: Buffer): Promise<Buffer> {
    try {
      // 画像のRGBAデータを取得
      const { data, info } = await sharp(inputBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // ピクセルごとに背景判定
      const threshold = 25; // 色差の許容値
      const grayMin = 180;  // グレー背景の最小値
      const grayMax = 250;  // グレー背景の最大値

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // RGBがほぼ同じ値（グレー）で、明るい色の場合は透過
        const isGray = Math.abs(r - g) < threshold &&
                       Math.abs(g - b) < threshold &&
                       Math.abs(r - b) < threshold;
        const isBright = r >= grayMin && r <= grayMax &&
                         g >= grayMin && g <= grayMax &&
                         b >= grayMin && b <= grayMax;

        if (isGray && isBright) {
          data[i + 3] = 0; // アルファを0に（透過）
        }
      }

      // 処理したデータをPNGとして出力
      return await sharp(data, {
        raw: {
          width: info.width,
          height: info.height,
          channels: 4,
        },
      })
        .png()
        .toBuffer();
    } catch (error) {
      logger.warn('背景透過処理に失敗、元画像を使用');
      return inputBuffer;
    }
  }

  /**
   * 単一画像にキャラクターを合成
   */
  async compositeCharacter(options: CompositeOptions): Promise<string> {
    await this.init();

    const {
      backgroundPath,
      outputPath,
      characterRole,
      position = 'right',
      useAngleVersion = false,
    } = options;

    // キャラクター情報を取得
    const character = this.characters?.get(characterRole);
    if (!character) {
      logger.warn(`キャラクター "${characterRole}" が見つかりません`);
      // キャラクターなしで出力
      await fs.copyFile(backgroundPath, outputPath);
      return outputPath;
    }

    // キャラクター画像パスを選択（現在はangleバージョンなし）
    const characterImagePath = character.imagePath;

    try {
      // 背景画像をバッファとして読み込み（同一ファイルへの出力に対応）
      const backgroundBuffer = await fs.readFile(backgroundPath);
      const backgroundMeta = await sharp(backgroundBuffer).metadata();
      const bgWidth = backgroundMeta.width || 1080;
      const bgHeight = backgroundMeta.height || 1350;

      // キャラクター画像を読み込み・リサイズ
      let characterBuffer = await sharp(characterImagePath)
        .resize(CHARACTER_SIZE.width, CHARACTER_SIZE.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      // 背景を透過処理
      characterBuffer = await this.removeGrayBackground(characterBuffer);

      // リサイズ後のサイズを取得
      const characterMeta = await sharp(characterBuffer).metadata();
      const charWidth = characterMeta.width || CHARACTER_SIZE.width;
      const charHeight = characterMeta.height || CHARACTER_SIZE.height;

      // 配置位置を計算
      const left = position === 'right'
        ? bgWidth - charWidth - CHARACTER_POSITION.right
        : CHARACTER_POSITION.left;
      const top = bgHeight - charHeight - CHARACTER_POSITION.bottom;

      // 背景にキャラクターを合成（バッファから読み込むことで同一ファイル出力可能）
      await sharp(backgroundBuffer)
        .composite([
          {
            input: characterBuffer,
            left: Math.round(left),
            top: Math.round(top),
          },
        ])
        .jpeg({ quality: 95 })
        .toFile(outputPath);

      logger.success(`キャラクター合成完了: ${path.basename(outputPath)}`);
      return outputPath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`キャラクター合成エラー: ${errorMessage}`);
      // エラー時は背景画像をそのまま使用
      await fs.copyFile(backgroundPath, outputPath);
      return outputPath;
    }
  }

  /**
   * カルーセル全スライドにキャラクターを合成
   * スライドごとに異なるキャラクターを配置
   */
  async compositeCarousel(
    backgroundPaths: string[],
    outputDir: string,
    topicId: string
  ): Promise<string[]> {
    await this.init();

    const outputPaths: string[] = [];
    await fs.mkdir(outputDir, { recursive: true });

    // スライドごとにキャラクターを割り当て
    const assignments = assignCharactersToSlides(backgroundPaths.length);

    for (let i = 0; i < backgroundPaths.length; i++) {
      const backgroundPath = backgroundPaths[i];
      const outputPath = path.join(outputDir, `slide_${i + 1}.jpg`);
      const assignedRoles = assignments[i];

      if (assignedRoles.length === 0) {
        // キャラクターなし
        await fs.copyFile(backgroundPath, outputPath);
        outputPaths.push(outputPath);
        continue;
      }

      // 最初のキャラクターを使用（複数の場合は右配置）
      const primaryRole = assignedRoles[0];
      const position: 'left' | 'right' = i % 2 === 0 ? 'right' : 'left';

      const result = await this.compositeCharacter({
        backgroundPath,
        outputPath,
        characterRole: primaryRole,
        position,
        useAngleVersion: i > 0, // 表紙以外は斜めバージョン
      });

      outputPaths.push(result);
      logger.info(`スライド ${i + 1}/${backgroundPaths.length} にキャラクター合成完了`);
    }

    return outputPaths;
  }

  /**
   * 表紙用：両方のキャラクターを合成
   */
  async compositeCoverWithBothCharacters(
    backgroundPath: string,
    outputPath: string
  ): Promise<string> {
    await this.init();

    try {
      // 背景画像のメタデータを取得
      const backgroundMeta = await sharp(backgroundPath).metadata();
      const bgWidth = backgroundMeta.width || 1080;
      const bgHeight = backgroundMeta.height || 1350;

      // 両キャラクターを取得
      const jukucho = this.characters?.get('塾長');
      const jukuto = this.characters?.get('塾頭');

      const composites: sharp.OverlayOptions[] = [];

      // 塾頭（左側）
      if (jukuto) {
        let jukutoBuffer = await sharp(jukuto.imagePath)
          .resize(280, 400, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();

        // 背景透過処理
        jukutoBuffer = await this.removeGrayBackground(jukutoBuffer);

        const jukutoMeta = await sharp(jukutoBuffer).metadata();
        const jWidth = jukutoMeta.width || 280;
        const jHeight = jukutoMeta.height || 400;

        composites.push({
          input: jukutoBuffer,
          left: CHARACTER_POSITION.left,
          top: bgHeight - jHeight - CHARACTER_POSITION.bottom,
        });
      }

      // 塾長（右側）
      if (jukucho) {
        let jukuchoBuffer = await sharp(jukucho.imagePath)
          .resize(280, 400, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();

        // 背景透過処理
        jukuchoBuffer = await this.removeGrayBackground(jukuchoBuffer);

        const jukuchoMeta = await sharp(jukuchoBuffer).metadata();
        const jWidth = jukuchoMeta.width || 280;
        const jHeight = jukuchoMeta.height || 400;

        composites.push({
          input: jukuchoBuffer,
          left: bgWidth - jWidth - CHARACTER_POSITION.right,
          top: bgHeight - jHeight - CHARACTER_POSITION.bottom,
        });
      }

      if (composites.length === 0) {
        await fs.copyFile(backgroundPath, outputPath);
        return outputPath;
      }

      // 合成
      await sharp(backgroundPath)
        .composite(composites)
        .jpeg({ quality: 95 })
        .toFile(outputPath);

      logger.success(`表紙に両キャラクター合成完了: ${path.basename(outputPath)}`);
      return outputPath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`表紙キャラクター合成エラー: ${errorMessage}`);
      await fs.copyFile(backgroundPath, outputPath);
      return outputPath;
    }
  }
}

export const characterCompositor = new CharacterCompositor();
