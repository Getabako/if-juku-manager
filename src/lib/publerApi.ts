/**
 * Publer API連携モジュール
 * Instagram投稿の自動スケジュール
 */
import { getPublerConfig } from './config.js';
import { logger } from './logger.js';

const BASE_URL = 'https://app.publer.com/api/v1';

// サンクスメッセージ画像の固定URL
const THANKS_IMAGE_URL = 'https://images.if-juku.net/thanks/ifjukuthanks.png';

interface MediaUploadResult {
  id: string;
  path: string;
  thumbnail: string;
  type: string;
  name: string;
  width: number;
  height: number;
}

interface JobStatus {
  status: 'working' | 'complete' | 'completed' | 'failed';
  payload?: MediaUploadResult[] | { failures?: Record<string, unknown> };
}

export interface SchedulePostOptions {
  imageUrls: string[];
  caption: string;
  scheduledAt: Date;
}

export class PublerApi {
  private apiKey: string;
  private workspaceId: string;
  private accountId: string;

  constructor() {
    const config = getPublerConfig();
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
    this.accountId = config.accountId;
  }

  /**
   * API リクエストを送信
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer-API ${this.apiKey}`,
      'Publer-Workspace-Id': this.workspaceId,
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Publer API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * ジョブステータスを確認（ポーリング）
   */
  private async waitForJob(jobId: string, maxAttempts = 30): Promise<JobStatus> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒待機

      const status = await this.request<JobStatus>(`/job_status/${jobId}`);

      if (status.status === 'completed' || status.status === 'complete') {
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(`Job failed: ${JSON.stringify(status.payload)}`);
      }

      logger.info(`ジョブ処理中... (${i + 1}/${maxAttempts})`);
    }

    throw new Error('Job timeout: ジョブが完了しませんでした');
  }

  /**
   * URLから画像をアップロード
   */
  async uploadMediaFromUrls(imageUrls: string[]): Promise<MediaUploadResult[]> {
    logger.info(`${imageUrls.length}枚の画像をPublerにアップロード中...`);

    // サンクス画像を追加
    const allUrls = [...imageUrls, THANKS_IMAGE_URL];

    const mediaItems = allUrls.map((url, index) => ({
      url,
      name: `slide_${index + 1}`,
    }));

    const response = await this.request<{ job_id: string }>('/media/from-url', {
      method: 'POST',
      body: JSON.stringify({
        media: mediaItems,
        type: 'bulk',
        direct_upload: false,
        in_library: true,
      }),
    });

    logger.info(`メディアアップロードジョブ開始: ${response.job_id}`);

    // ジョブ完了を待機
    const jobResult = await this.waitForJob(response.job_id);

    // payloadが配列の場合（メディアアップロード成功時）
    if (!Array.isArray(jobResult.payload)) {
      throw new Error('メディアアップロード結果が取得できませんでした');
    }

    logger.info(`${jobResult.payload.length}枚のメディアをアップロード完了`);
    return jobResult.payload;
  }

  /**
   * 日時をISO 8601形式に変換（JST）
   * Publerは+09:00のタイムゾーンオフセットを期待
   */
  private formatScheduleDate(date: Date): string {
    // JSTで日時をフォーマット（+09:00）
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    // JST (+09:00) として送信
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+09:00`;
  }

  /**
   * カルーセル投稿をスケジュール
   */
  async scheduleCarouselPost(options: SchedulePostOptions): Promise<string> {
    logger.info('Instagramカルーセル投稿をスケジュール中...');

    // 1. 画像をアップロード
    const mediaResults = await this.uploadMediaFromUrls(options.imageUrls);

    // 2. メディアIDを取得（in_library: true が必要）
    const mediaArray = mediaResults.map(m => ({
      id: m.id,
      type: 'photo',
      in_library: true,
    }));

    // 3. 投稿を作成
    const scheduledTime = this.formatScheduleDate(options.scheduledAt);

    const postPayload = {
      bulk: {
        state: 'scheduled',
        scheduled_at: scheduledTime,
        posts: [
          {
            networks: {
              instagram: {
                type: 'photo',
                text: options.caption,
                media: mediaArray,
              },
            },
            accounts: [{ id: this.accountId }],
          },
        ],
      },
    };

    logger.info(`スケジュール日時: ${options.scheduledAt.toLocaleString('ja-JP')}`);

    const response = await this.request<{ job_id: string }>('/posts/schedule', {
      method: 'POST',
      body: JSON.stringify(postPayload),
    });

    logger.info(`投稿スケジュールジョブ開始: ${response.job_id}`);

    // ジョブ完了を待機
    await this.waitForJob(response.job_id);

    logger.success('Instagram投稿のスケジュールが完了しました');
    return response.job_id;
  }

  /**
   * 投稿日時を計算（翌日の18:00 JST）
   */
  calculatePostDate(): Date {
    const now = new Date();
    const postDate = new Date(now);
    postDate.setDate(postDate.getDate() + 1); // 翌日
    postDate.setHours(18, 0, 0, 0); // 18:00
    return postDate;
  }

  /**
   * ワークフロー結果からInstagram投稿をスケジュール
   */
  async scheduleFromWorkflowResult(result: {
    imageUrls: string[];
    caption: string;
    postDate?: Date;
  }): Promise<{ jobId: string; scheduledAt: Date }> {
    const scheduledAt = result.postDate || this.calculatePostDate();

    const jobId = await this.scheduleCarouselPost({
      imageUrls: result.imageUrls,
      caption: result.caption,
      scheduledAt,
    });

    return { jobId, scheduledAt };
  }
}

export const publerApi = new PublerApi();
