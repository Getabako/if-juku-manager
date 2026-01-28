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

    const responseText = await response.text();
    logger.info(`Publer API Response [${endpoint}]: ${response.status}`);

    if (!response.ok) {
      logger.error(`Publer API Error Response: ${responseText}`);
      throw new Error(`Publer API error: ${response.status} - ${responseText}`);
    }

    // レスポンスをログに出力（デバッグ用）
    logger.info(`Publer API Response Body: ${responseText.slice(0, 500)}`);

    try {
      return JSON.parse(responseText);
    } catch (e) {
      logger.error(`Failed to parse JSON: ${responseText}`);
      throw new Error(`Invalid JSON response: ${responseText}`);
    }
  }

  /**
   * ジョブステータスを確認（ポーリング）
   * maxAttemptsを150に増加（300秒＝5分待機）- 5枚バルクアップロード対応
   * Publerのメディア処理は時間がかかることがある
   */
  private async waitForJob(jobId: string, maxAttempts = 150): Promise<JobStatus> {
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
   * URLから画像をアップロード（1枚ずつ順番に処理）
   * 一括アップロードはPublerの処理が遅くタイムアウトしやすいため、
   * 1枚ずつアップロードして確実に処理する
   */
  async uploadMediaFromUrls(imageUrls: string[]): Promise<MediaUploadResult[]> {
    // サンクス画像を追加
    const allUrls = [...imageUrls, THANKS_IMAGE_URL];
    logger.info(`${allUrls.length}枚の画像をPublerに1枚ずつアップロード中...`);

    const results: MediaUploadResult[] = [];

    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      logger.info(`画像 ${i + 1}/${allUrls.length} をアップロード中...`);

      try {
        // 1枚ずつアップロード
        const response = await this.request<{ job_id: string }>('/media/from-url', {
          method: 'POST',
          body: JSON.stringify({
            media: [{ url, name: `slide_${i + 1}` }],
            direct_upload: false,
            in_library: true,
          }),
        });

        logger.info(`  ジョブID: ${response.job_id}`);

        // ジョブ完了を待機（1枚でも時間がかかる場合があるので120秒待機）
        const jobResult = await this.waitForJob(response.job_id, 60);

        if (Array.isArray(jobResult.payload) && jobResult.payload.length > 0) {
          results.push(jobResult.payload[0]);
          logger.info(`  ✓ 画像 ${i + 1} アップロード完了`);
        } else {
          throw new Error(`画像 ${i + 1} のアップロード結果が取得できませんでした`);
        }

        // API制限回避のため少し待機
        if (i < allUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger.error(`画像 ${i + 1} のアップロードに失敗: ${error}`);
        throw error;
      }
    }

    logger.info(`${results.length}枚のメディアをアップロード完了`);
    return results;
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
    logger.info(`投稿ペイロード: ${JSON.stringify(postPayload, null, 2)}`);

    // ジョブ完了を待機
    const jobResult = await this.waitForJob(response.job_id);
    logger.info(`投稿スケジュールジョブ結果: ${JSON.stringify(jobResult, null, 2)}`);

    // ジョブ結果を確認
    if (jobResult.payload && typeof jobResult.payload === 'object') {
      const payload = jobResult.payload as Record<string, unknown>;
      if (payload.failures && Object.keys(payload.failures as object).length > 0) {
        logger.error(`投稿スケジュール失敗: ${JSON.stringify(payload.failures)}`);
        throw new Error(`Publer投稿スケジュール失敗: ${JSON.stringify(payload.failures)}`);
      }
    }

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
