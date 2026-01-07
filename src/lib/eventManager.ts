/**
 * イベント管理モジュール
 * events.jsonから実際のイベントデータを読み込み、
 * 活動報告やお知らせの投稿を生成
 */
import fs from 'fs/promises';
import path from 'path';
import { PATHS } from './config.js';
import { logger } from './logger.js';
import { contentGenerator } from './contentGenerator.js';
import { photoMetadataParser, PhotoMetadata } from './photoMetadata.js';
import type { Topic, Slide, CategoryType } from './types.js';

// イベントデータの型定義
interface ActivityReport {
  id: string;
  title: string;
  date: string;
  event_type: 'media' | 'competition' | 'education' | 'development' | 'team' | 'event';
  location: string;
  participants: string[];
  description: string;
  highlights: string[];
  photos: string[];
  hashtags: string[];
  used: boolean;
}

interface Announcement {
  id: string;
  title: string;
  date_range: {
    start: string;
    end: string;
  };
  type: 'recruitment' | 'ongoing' | 'event' | 'news';
  target: string;
  location: string;
  description: string;
  benefits: string[];
  details: Record<string, string>;
  cta: string;
  hashtags: string[];
  used: boolean;
}

interface EventsData {
  activity_reports: ActivityReport[];
  announcements: Announcement[];
  settings: {
    auto_select_photos: boolean;
    priority_smiling_faces: boolean;
    max_photos_per_post: number;
  };
}

export class EventManager {
  private eventsPath: string;
  private eventsData: EventsData | null = null;

  constructor() {
    this.eventsPath = path.join(PATHS.data, 'events.json');
  }

  /**
   * events.jsonを読み込み
   */
  async loadEvents(): Promise<EventsData> {
    if (this.eventsData) {
      return this.eventsData;
    }

    try {
      const data = await fs.readFile(this.eventsPath, 'utf-8');
      this.eventsData = JSON.parse(data) as EventsData;
      logger.info(`${this.eventsData.activity_reports.length} 件の活動報告、${this.eventsData.announcements.length} 件のお知らせを読み込みました`);
      return this.eventsData;
    } catch (error) {
      logger.warn('events.json の読み込みに失敗しました。デフォルトデータを使用します');
      return {
        activity_reports: [],
        announcements: [],
        settings: {
          auto_select_photos: true,
          priority_smiling_faces: true,
          max_photos_per_post: 5
        }
      };
    }
  }

  /**
   * 未使用の活動報告を取得
   */
  async getUnusedActivityReport(): Promise<ActivityReport | null> {
    const data = await this.loadEvents();
    const unused = data.activity_reports.filter(r => !r.used);

    if (unused.length === 0) {
      // 全て使用済みの場合はリセット
      logger.info('全ての活動報告が使用済みです。リセットします');
      data.activity_reports.forEach(r => r.used = false);
      await this.saveEvents();
      return data.activity_reports[0] || null;
    }

    // 日付が新しい順に並べて最初のものを返す
    unused.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return unused[0];
  }

  /**
   * 未使用のお知らせを取得
   */
  async getUnusedAnnouncement(): Promise<Announcement | null> {
    const data = await this.loadEvents();
    const now = new Date();

    // 有効期限内で未使用のお知らせ
    const unused = data.announcements.filter(a => {
      if (a.used) return false;
      const endDate = new Date(a.date_range.end);
      return endDate >= now;
    });

    if (unused.length === 0) {
      return null;
    }

    // 開始日が近い順
    unused.sort((a, b) =>
      new Date(a.date_range.start).getTime() - new Date(b.date_range.start).getTime()
    );
    return unused[0];
  }

  /**
   * 活動報告からトピックを生成
   */
  async generateActivityTopic(report: ActivityReport): Promise<Topic> {
    // 写真のメタデータを取得
    const photoMetadata: PhotoMetadata[] = [];
    for (const photoName of report.photos) {
      const filepath = path.join(PATHS.rawPhotos, photoName);
      try {
        await fs.access(filepath);
        photoMetadata.push({
          filename: photoName,
          filepath,
          event: report.title,
          people: report.participants,
          expression: 'unknown',
          pose: 'unknown',
          description: report.description,
          category: 'activity'
        });
      } catch {
        logger.warn(`写真が見つかりません: ${photoName}`);
      }
    }

    // スライドを生成
    const slides: Slide[] = [
      {
        type: 'cover',
        headline: report.title,
        subtext: `📍 ${report.location}`
      },
      {
        type: 'content',
        headline: '活動内容',
        points: report.highlights.slice(0, 3)
      },
      {
        type: 'content',
        headline: 'メンバーの様子',
        points: [
          `参加メンバー: ${report.participants.join('、')}`,
          report.description.slice(0, 50) + (report.description.length > 50 ? '...' : ''),
          '詳しくは投稿をチェック！'
        ]
      },
      {
        type: 'content',
        headline: '学び・気づき',
        points: [
          '貴重な経験ができました',
          '次回もお楽しみに',
          'if塾でスキルアップ！'
        ]
      },
      {
        type: 'thanks',
        headline: '次回もお楽しみに！',
        cta: '無料体験・見学歓迎'
      }
    ];

    // キャプションを生成
    const caption = this.generateActivityCaption(report);

    return {
      id: report.id,
      category: 'activity',
      title: report.title,
      slides,
      caption,
      usedCount: 0
    };
  }

  /**
   * お知らせからトピックを生成
   */
  async generateAnnouncementTopic(announcement: Announcement): Promise<Topic> {
    const slides: Slide[] = [
      {
        type: 'cover',
        headline: announcement.title.replace(/！/g, '').slice(0, 15),
        subtext: announcement.target
      },
      {
        type: 'content',
        headline: '内容',
        points: [announcement.description.slice(0, 80)]
      },
      {
        type: 'content',
        headline: 'メリット',
        points: announcement.benefits.slice(0, 3)
      },
      {
        type: 'content',
        headline: '詳細',
        points: Object.entries(announcement.details).map(([k, v]) => `${k}: ${v}`).slice(0, 3)
      },
      {
        type: 'thanks',
        headline: 'お申込みはお早めに！',
        cta: announcement.cta
      }
    ];

    const caption = this.generateAnnouncementCaption(announcement);

    return {
      id: announcement.id,
      category: 'announcement',
      title: announcement.title,
      slides,
      caption,
      usedCount: 0
    };
  }

  /**
   * 活動報告用キャプション生成
   */
  private generateActivityCaption(report: ActivityReport): string {
    let caption = `📸 ${report.title}\n\n`;
    caption += `📅 ${report.date}\n`;
    caption += `📍 ${report.location}\n\n`;
    caption += `${report.description}\n\n`;
    caption += `✨ ハイライト\n`;
    report.highlights.forEach(h => {
      caption += `・${h}\n`;
    });
    caption += `\n👥 参加: ${report.participants.join('、')}\n\n`;
    caption += report.hashtags.join(' ');
    return caption;
  }

  /**
   * お知らせ用キャプション生成
   */
  private generateAnnouncementCaption(announcement: Announcement): string {
    let caption = `📢 ${announcement.title}\n\n`;
    caption += `${announcement.description}\n\n`;
    caption += `✅ こんな方におすすめ\n`;
    announcement.benefits.forEach(b => {
      caption += `・${b}\n`;
    });
    caption += `\n📋 詳細\n`;
    Object.entries(announcement.details).forEach(([k, v]) => {
      caption += `・${k}: ${v}\n`;
    });
    caption += `\n👉 ${announcement.cta}\n\n`;
    caption += announcement.hashtags.join(' ');
    return caption;
  }

  /**
   * イベントを使用済みにマーク
   */
  async markAsUsed(id: string, type: 'activity' | 'announcement'): Promise<void> {
    const data = await this.loadEvents();

    if (type === 'activity') {
      const report = data.activity_reports.find(r => r.id === id);
      if (report) {
        report.used = true;
      }
    } else {
      const announcement = data.announcements.find(a => a.id === id);
      if (announcement) {
        announcement.used = true;
      }
    }

    await this.saveEvents();
  }

  /**
   * events.jsonを保存
   */
  private async saveEvents(): Promise<void> {
    if (!this.eventsData) return;

    try {
      await fs.writeFile(
        this.eventsPath,
        JSON.stringify(this.eventsData, null, 2),
        'utf-8'
      );
      logger.debug('events.json を保存しました');
    } catch (error) {
      logger.error('events.json の保存に失敗しました');
    }
  }

  /**
   * 写真パスの配列を取得（活動報告用）
   */
  async getPhotoPathsForReport(report: ActivityReport): Promise<string[]> {
    const paths: string[] = [];
    for (const photoName of report.photos) {
      const filepath = path.join(PATHS.rawPhotos, photoName);
      try {
        await fs.access(filepath);
        paths.push(filepath);
      } catch {
        // ファイルが存在しない場合はスキップ
      }
    }
    return paths;
  }
}

export const eventManager = new EventManager();
