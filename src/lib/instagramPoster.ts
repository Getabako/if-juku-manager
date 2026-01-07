/**
 * Instagram Graph API 投稿モジュール
 * カルーセル投稿とリール投稿をサポート
 */
import axios, { type AxiosInstance } from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import path from 'path';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import type { InstagramPostResult, CarouselGenerationResult, ReelGenerationResult } from './types.js';

const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class InstagramPoster {
  private client: AxiosInstance;
  private accountId: string;
  private accessToken: string;

  constructor() {
    const config = getConfig();

    if (!config.instagramAccountId || !config.instagramAccessToken) {
      logger.warn('Instagram API認証情報が設定されていません');
    }

    this.accountId = config.instagramAccountId;
    this.accessToken = config.instagramAccessToken;

    this.client = axios.create({
      baseURL: GRAPH_API_BASE,
      timeout: 60000,
    });
  }

  /**
   * 認証情報が設定されているか確認
   */
  isConfigured(): boolean {
    return Boolean(this.accountId && this.accessToken);
  }

  /**
   * 画像URLを指定してメディアコンテナを作成
   * ※Instagram Graph APIは公開URLを必要とするため、
   * 実運用では画像をCloudinaryなどにアップロードする必要あり
   */
  private async createImageContainer(imageUrl: string): Promise<string> {
    try {
      const response = await this.client.post(`/${this.accountId}/media`, null, {
        params: {
          image_url: imageUrl,
          access_token: this.accessToken,
        },
      });

      return response.data.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      throw new Error(`画像コンテナの作成に失敗: ${message}`);
    }
  }

  /**
   * カルーセル用のメディアコンテナを作成
   */
  private async createCarouselItemContainer(imageUrl: string): Promise<string> {
    try {
      const response = await this.client.post(`/${this.accountId}/media`, null, {
        params: {
          image_url: imageUrl,
          is_carousel_item: true,
          access_token: this.accessToken,
        },
      });

      return response.data.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      throw new Error(`カルーセルアイテムコンテナの作成に失敗: ${message}`);
    }
  }

  /**
   * カルーセルコンテナを作成
   */
  private async createCarouselContainer(
    childrenIds: string[],
    caption: string
  ): Promise<string> {
    try {
      const response = await this.client.post(`/${this.accountId}/media`, null, {
        params: {
          media_type: 'CAROUSEL',
          children: childrenIds.join(','),
          caption,
          access_token: this.accessToken,
        },
      });

      return response.data.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      throw new Error(`カルーセルコンテナの作成に失敗: ${message}`);
    }
  }

  /**
   * リール用のメディアコンテナを作成
   */
  private async createReelContainer(
    videoUrl: string,
    caption: string,
    coverUrl?: string
  ): Promise<string> {
    try {
      const params: Record<string, string> = {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        access_token: this.accessToken,
      };

      if (coverUrl) {
        params.cover_url = coverUrl;
      }

      const response = await this.client.post(`/${this.accountId}/media`, null, {
        params,
      });

      return response.data.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      throw new Error(`リールコンテナの作成に失敗: ${message}`);
    }
  }

  /**
   * メディアを公開
   */
  private async publishMedia(containerId: string): Promise<string> {
    try {
      const response = await this.client.post(
        `/${this.accountId}/media_publish`,
        null,
        {
          params: {
            creation_id: containerId,
            access_token: this.accessToken,
          },
        }
      );

      return response.data.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      throw new Error(`メディアの公開に失敗: ${message}`);
    }
  }

  /**
   * メディアコンテナのステータスをチェック
   */
  private async checkContainerStatus(containerId: string): Promise<string> {
    try {
      const response = await this.client.get(`/${containerId}`, {
        params: {
          fields: 'status_code,status',
          access_token: this.accessToken,
        },
      });

      return response.data.status_code;
    } catch (error) {
      return 'ERROR';
    }
  }

  /**
   * コンテナが公開可能になるまで待機
   */
  private async waitForContainerReady(
    containerId: string,
    maxWaitSeconds: number = 120
  ): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5秒ごとにチェック

    while (Date.now() - startTime < maxWaitSeconds * 1000) {
      const status = await this.checkContainerStatus(containerId);

      if (status === 'FINISHED') {
        return true;
      }

      if (status === 'ERROR') {
        throw new Error('メディア処理中にエラーが発生しました');
      }

      logger.debug(`コンテナステータス: ${status}, 待機中...`);
      await this.delay(pollInterval);
    }

    throw new Error('メディア処理がタイムアウトしました');
  }

  /**
   * カルーセル投稿を実行
   *
   * ※注意: Instagram Graph APIは公開URLを必要とするため、
   * 実運用では画像をCloud Storageにアップロードする必要があります
   */
  async postCarousel(
    result: CarouselGenerationResult,
    imageUrls: string[] // 公開URL
  ): Promise<InstagramPostResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Instagram API認証情報が設定されていません',
        postedAt: new Date(),
      };
    }

    try {
      logger.info('カルーセル投稿を開始...');

      // 1. 各画像のコンテナを作成
      const childrenIds: string[] = [];
      for (const imageUrl of imageUrls) {
        const containerId = await this.createCarouselItemContainer(imageUrl);
        childrenIds.push(containerId);
        logger.debug(`アイテムコンテナ作成: ${containerId}`);
      }

      // 2. カルーセルコンテナを作成
      const carouselId = await this.createCarouselContainer(
        childrenIds,
        result.caption
      );
      logger.debug(`カルーセルコンテナ作成: ${carouselId}`);

      // 3. コンテナが準備できるまで待機
      await this.waitForContainerReady(carouselId);

      // 4. 公開
      const postId = await this.publishMedia(carouselId);
      logger.success(`カルーセル投稿完了: ${postId}`);

      return {
        success: true,
        postId,
        postedAt: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`カルーセル投稿エラー: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        postedAt: new Date(),
      };
    }
  }

  /**
   * リール投稿を実行
   */
  async postReel(
    result: ReelGenerationResult,
    videoUrl: string, // 公開URL
    coverUrl?: string
  ): Promise<InstagramPostResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Instagram API認証情報が設定されていません',
        postedAt: new Date(),
      };
    }

    try {
      logger.info('リール投稿を開始...');

      // 1. リールコンテナを作成
      const containerId = await this.createReelContainer(
        videoUrl,
        result.caption,
        coverUrl
      );
      logger.debug(`リールコンテナ作成: ${containerId}`);

      // 2. コンテナが準備できるまで待機（動画は時間がかかる）
      await this.waitForContainerReady(containerId, 300);

      // 3. 公開
      const postId = await this.publishMedia(containerId);
      logger.success(`リール投稿完了: ${postId}`);

      return {
        success: true,
        postId,
        postedAt: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`リール投稿エラー: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        postedAt: new Date(),
      };
    }
  }

  /**
   * アカウント情報を取得（テスト用）
   */
  async getAccountInfo(): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const response = await this.client.get(`/${this.accountId}`, {
        params: {
          fields: 'id,username,name,profile_picture_url,followers_count,media_count',
          access_token: this.accessToken,
        },
      });

      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      logger.error(`アカウント情報の取得に失敗: ${message}`);
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const instagramPoster = new InstagramPoster();
