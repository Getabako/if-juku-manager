/**
 * FTP アップローダーモジュール
 * Xserverへの画像アップロードを管理
 * https://images.if-juku.net/ に公開
 */
import * as ftp from 'basic-ftp';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

// FTP設定（環境変数から取得）
interface FtpConfig {
  host: string;
  user: string;
  password: string;
  port: number;
  secure: boolean;
  remoteDir: string;
  publicUrl: string;
}

// デフォルト設定を取得する関数（遅延評価で環境変数を読み込む）
function getDefaultFtpConfig(): FtpConfig {
  return {
    host: process.env.FTP_HOST || 'sv8109.xserver.jp',
    user: process.env.FTP_USER || 'getabakoclub',
    password: process.env.FTP_PASSWORD || '',
    port: parseInt(process.env.FTP_PORT || '21'),
    secure: process.env.FTP_SECURE === 'true',
    remoteDir: process.env.FTP_REMOTE_DIR || '/images.if-juku.net/public_html/instagram',
    publicUrl: process.env.FTP_PUBLIC_URL || 'https://images.if-juku.net/instagram',
  };
}

export interface UploadResult {
  success: boolean;
  localPath: string;
  remotePath?: string;
  publicUrl?: string;
  error?: string;
}

export class FtpUploader {
  private config: FtpConfig;
  private client: ftp.Client;

  constructor(config?: Partial<FtpConfig>) {
    this.config = { ...getDefaultFtpConfig(), ...config };
    this.client = new ftp.Client();
    this.client.ftp.verbose = false; // 本番用
  }

  /**
   * FTPサーバーに接続
   */
  async connect(): Promise<boolean> {
    try {
      await this.client.access({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        port: this.config.port,
        secure: this.config.secure,
        secureOptions: {
          rejectUnauthorized: false, // 自己署名証明書を許可
        },
      });
      logger.info(`FTPサーバーに接続しました: ${this.config.host}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`FTP接続エラー: ${errorMessage}`);
      return false;
    }
  }

  /**
   * FTP接続を閉じる
   */
  close(): void {
    this.client.close();
    logger.debug('FTP接続を終了しました');
  }

  /**
   * リモートディレクトリを作成（存在しない場合）
   */
  async ensureRemoteDir(remotePath: string): Promise<void> {
    try {
      await this.client.ensureDir(remotePath);
    } catch (error) {
      logger.debug(`ディレクトリ作成: ${remotePath}`);
    }
  }

  /**
   * 単一ファイルをアップロード
   */
  async uploadFile(localPath: string, customFileName?: string): Promise<UploadResult> {
    try {
      // ファイルの存在確認
      await fs.access(localPath);

      // ファイル名を生成
      const ext = path.extname(localPath);
      const fileName = customFileName || `${uuidv4()}${ext}`;

      // 日付ベースのディレクトリを作成
      const today = new Date();
      const dateDir = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}`;
      const fullRemoteDir = `${this.config.remoteDir}/${dateDir}`;
      const remotePath = `${fullRemoteDir}/${fileName}`;
      const publicUrl = `${this.config.publicUrl}/${dateDir}/${fileName}`;

      // 接続確認
      if (this.client.closed) {
        const connected = await this.connect();
        if (!connected) {
          throw new Error('FTP接続に失敗しました');
        }
      }

      // リモートディレクトリを確保
      await this.ensureRemoteDir(fullRemoteDir);

      // ファイルをアップロード
      await this.client.uploadFrom(localPath, remotePath);
      logger.success(`アップロード完了: ${publicUrl}`);

      return {
        success: true,
        localPath,
        remotePath,
        publicUrl,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`アップロードエラー: ${errorMessage}`);
      return {
        success: false,
        localPath,
        error: errorMessage,
      };
    }
  }

  /**
   * 複数ファイルをアップロード
   */
  async uploadFiles(localPaths: string[]): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    // 接続
    const connected = await this.connect();
    if (!connected) {
      return localPaths.map((p) => ({
        success: false,
        localPath: p,
        error: 'FTP接続に失敗しました',
      }));
    }

    try {
      for (const localPath of localPaths) {
        const result = await this.uploadFile(localPath);
        results.push(result);
      }
    } finally {
      this.close();
    }

    return results;
  }

  /**
   * カルーセル画像をアップロードして公開URLを取得
   * topicIdフォルダを作成し、その中に画像を配置
   */
  async uploadCarouselImages(localPaths: string[], topicId: string): Promise<string[]> {
    const publicUrls: string[] = [];

    // 接続
    const connected = await this.connect();
    if (!connected) {
      throw new Error('FTP接続に失敗しました');
    }

    try {
      // 日付ベースのディレクトリ + topicIdフォルダを作成
      const today = new Date();
      const dateDir = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}`;
      const topicDir = `${this.config.remoteDir}/${dateDir}/${topicId}`;
      const publicBaseUrl = `${this.config.publicUrl}/${dateDir}/${topicId}`;

      // フォルダを作成
      await this.ensureRemoteDir(topicDir);
      logger.info(`フォルダを作成: ${topicDir}`);

      for (let i = 0; i < localPaths.length; i++) {
        const localPath = localPaths[i];
        const fileName = `slide_${i + 1}${path.extname(localPath)}`;
        const remotePath = `${topicDir}/${fileName}`;
        const publicUrl = `${publicBaseUrl}/${fileName}`;

        try {
          // ファイルの存在確認
          await fs.access(localPath);

          // ファイルをアップロード
          await this.client.uploadFrom(localPath, remotePath);
          logger.success(`アップロード完了: ${publicUrl}`);
          publicUrls.push(publicUrl);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '不明なエラー';
          logger.warn(`スライド ${i + 1} のアップロードに失敗: ${errorMessage}`);
        }
      }
    } finally {
      this.close();
    }

    return publicUrls;
  }

  /**
   * 接続テスト
   */
  async testConnection(): Promise<boolean> {
    try {
      const connected = await this.connect();
      if (!connected) {
        return false;
      }

      // ディレクトリ一覧を取得してテスト
      const list = await this.client.list('/');
      logger.info(`FTP接続テスト成功: ${list.length} アイテム確認`);

      this.close();
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`FTP接続テスト失敗: ${errorMessage}`);
      return false;
    }
  }

  /**
   * 設定情報を取得（パスワードは隠す）
   */
  getConfigInfo(): Record<string, string> {
    return {
      host: this.config.host,
      user: this.config.user,
      port: this.config.port.toString(),
      remoteDir: this.config.remoteDir,
      publicUrl: this.config.publicUrl,
    };
  }
}

// デフォルトインスタンス
export const ftpUploader = new FtpUploader();

// 設定付きでインスタンスを作成するファクトリ関数
export function createFtpUploader(config: Partial<FtpConfig>): FtpUploader {
  return new FtpUploader(config);
}
