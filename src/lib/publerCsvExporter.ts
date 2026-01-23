/**
 * Publer CSV出力モジュール
 * SNS管理ツールPubler用のCSVフォーマットで投稿データを出力
 * 都度新しいCSVファイルを作成する
 */
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

// サンクスメッセージ画像の固定URL
const THANKS_IMAGE_URL = 'https://images.if-juku.net/thanks/ifjukuthanks.png';

// CSV出力先ディレクトリ
const CSV_OUTPUT_DIR = '/Users/takasaki19841121/Desktop/ifJukuManager';

export interface PublerPostData {
  date: Date;
  caption: string;
  imageUrls: string[];
}

export class PublerCsvExporter {
  /**
   * 日付をPubler形式にフォーマット (YYYY-MM-DD HH:MM)
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * ファイル名用のタイムスタンプを生成
   */
  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }

  /**
   * キャプションを整形（改行をスペースに変換してハッシュタグを続ける）
   */
  private normalizeCaption(caption: string): string {
    // 改行をスペースに変換（ハッシュタグの前の改行も含む）
    // 連続するスペースは1つにまとめる
    return caption.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * CSVフィールドをエスケープ（ダブルクォートとカンマ対応）
   */
  private escapeField(field: string): string {
    // 常にダブルクォートで囲む（安全のため）
    // ダブルクォートをエスケープ
    return `"${field.replace(/"/g, '""')}"`;
  }

  /**
   * 投稿データからCSV行を生成
   */
  generateCsvRow(postData: PublerPostData): string {
    const date = this.formatDate(postData.date);
    // キャプションを整形してからエスケープ
    const normalizedCaption = this.normalizeCaption(postData.caption);
    const text = this.escapeField(normalizedCaption);
    const links = ''; // Link(s)は空

    // Media URL(s): スライド画像 + サンクスメッセージ画像
    const mediaUrls = [...postData.imageUrls, THANKS_IMAGE_URL].join(',');

    return `${date},${text},${links},${mediaUrls}`;
  }

  /**
   * 新しいCSVファイルを作成
   */
  async createNewCsv(postData: PublerPostData): Promise<string> {
    try {
      const csvRow = this.generateCsvRow(postData);
      const timestamp = this.generateTimestamp();
      const fileName = `投稿データ_${timestamp}.csv`;
      const filePath = path.join(CSV_OUTPUT_DIR, fileName);

      // ヘッダー + データ行
      const header = 'Date,Text,Link(s),Media URL(s)\n';
      await fs.writeFile(filePath, header + csvRow + '\n', 'utf-8');

      logger.info(`新規CSVファイルを作成: ${filePath}`);
      logger.info(`Publer用CSV行を出力しました`);

      return filePath;
    } catch (error) {
      logger.error(`CSV出力エラー: ${error}`);
      throw error;
    }
  }

  /**
   * 投稿日時を計算（翌日の18:00）
   */
  calculatePostDate(): Date {
    const now = new Date();
    const postDate = new Date(now);
    postDate.setDate(postDate.getDate() + 1); // 翌日
    postDate.setHours(18, 0, 0, 0); // 18:00
    return postDate;
  }

  /**
   * 生成結果からCSVデータを作成して出力
   */
  async exportFromWorkflowResult(result: {
    imageUrls: string[];
    caption: string;
    postDate?: Date;
  }): Promise<{ csvRow: string; filePath: string }> {
    const postDate = result.postDate || this.calculatePostDate();

    const postData: PublerPostData = {
      date: postDate,
      caption: result.caption,
      imageUrls: result.imageUrls,
    };

    const filePath = await this.createNewCsv(postData);
    const csvRow = this.generateCsvRow(postData);

    return { csvRow, filePath };
  }
}

export const publerCsvExporter = new PublerCsvExporter();
