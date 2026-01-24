/**
 * 写真メタデータ解析モジュール
 * ファイル名から撮影情報を抽出し、活動報告コンテンツを生成
 */
import fs from 'fs/promises';
import path from 'path';
import { PATHS } from './config.js';
import { logger } from './logger.js';

// 写真メタデータ型定義
export interface PhotoMetadata {
  filename: string;
  filepath: string;
  event: string;           // イベント名/場所
  people: string[];        // 写っている人物
  expression: string;      // 表情
  pose: string;           // ポーズ/動作
  description: string;    // 詳細説明
  category: 'activity' | 'announcement' | 'team' | 'event' | 'workspace';
}

// イベント情報の詳細マッピング
export const EVENT_INFO: Record<string, {
  name: string;
  type: 'media' | 'competition' | 'education' | 'development' | 'team' | 'event';
  description: string;
  hashtags: string[];
}> = {
  'ABSエキマイク': {
    name: 'ABSラジオ出演',
    type: 'media',
    description: 'ABSラジオ「エキマイク」に出演しました',
    hashtags: ['#ラジオ出演', '#ABSラジオ', '#メディア出演', '#秋田']
  },
  'CNA秋田テレビ': {
    name: 'CNA秋田テレビ取材',
    type: 'media',
    description: 'CNA秋田テレビの取材を受けました',
    hashtags: ['#テレビ出演', '#CNA', '#秋田テレビ', '#メディア']
  },
  'NeXt10': {
    name: 'NeXt10ビジネスコンテスト',
    type: 'competition',
    description: 'NeXt10ビジネスコンテストに参加しました',
    hashtags: ['#NeXt10', '#ビジネスコンテスト', '#起業', '#秋田']
  },
  '足音': {
    name: '足音ゲーム発表会',
    type: 'development',
    description: '自作ゲーム「足音」の発表会に参加しました',
    hashtags: ['#ゲーム開発', '#インディーゲーム', '#発表会', '#学生開発']
  },
  'ノースアジア大学': {
    name: 'ノースアジア大学eスポーツ大会',
    type: 'competition',
    description: 'ノースアジア大学でのストリートファイター6大会に参加しました',
    hashtags: ['#eスポーツ', '#SF6', '#ストリートファイター', '#大会']
  },
  'RPG体験スペース': {
    name: 'RPG体験イベント',
    type: 'event',
    description: 'RPG体験スペースでスタッフとして活動しました',
    hashtags: ['#イベントスタッフ', '#RPG', '#ゲーム体験']
  },
  'eスポーツ部': {
    name: 'eスポーツ部活動',
    type: 'team',
    description: 'eスポーツ部での練習風景です',
    hashtags: ['#eスポーツ部', '#部活動', '#ゲーム', '#練習']
  },
  'e-sport部': {
    name: 'eスポーツ部活動',
    type: 'team',
    description: 'eスポーツ部での練習風景です',
    hashtags: ['#eスポーツ部', '#部活動', '#ゲーム', '#練習']
  },
  'tsuguba': {
    name: 'つぐば子供プログラミング教室',
    type: 'education',
    description: '子供向けプログラミング教室でサポートしました',
    hashtags: ['#プログラミング教育', '#子供向け', '#教育活動']
  },
  'クラーク校内': {
    name: 'クラーク記念国際高等学校',
    type: 'team',
    description: 'クラーク記念国際高等学校での活動',
    hashtags: ['#クラーク', '#高校生活', '#学校']
  },
  'コワークスペース': {
    name: 'コワーキングスペース作業',
    type: 'team',
    description: 'コワーキングスペースでのチーム作業',
    hashtags: ['#コワーキング', '#チーム作業', '#開発']
  },
  'ワークスペース': {
    name: 'ワークスペース作業',
    type: 'team',
    description: 'ワークスペースでの開発作業',
    hashtags: ['#開発', '#作業風景', '#チーム']
  },
  'メイクマネー': {
    name: 'メイクマネーサバイブスタジオ',
    type: 'competition',
    description: 'ビジネスイベントに参加しました',
    hashtags: ['#ビジネス', '#イベント', '#起業']
  },
  '横手e-sport大会': {
    name: '横手eスポーツ大会',
    type: 'competition',
    description: '横手でのeスポーツ大会に参加しました',
    hashtags: ['#eスポーツ', '#横手', '#大会', '#ぷよぷよ']
  },
  '横手イベント体験スペース': {
    name: '横手ゲーム体験イベント',
    type: 'event',
    description: '横手でのゲーム体験イベントでサポートしました',
    hashtags: ['#横手', '#イベント', '#ゲーム体験', '#マイクラ']
  }
};

// メンバー情報
export const MEMBER_INFO: Record<string, {
  name: string;
  role: string;
}> = {
  '高崎': { name: '高崎', role: '代表' },
  '山崎': { name: '山崎', role: 'メンバー' },
  '山﨑': { name: '山崎', role: 'メンバー' },
  '加賀屋': { name: '加賀屋', role: 'メンバー' },
  '井上': { name: '井上', role: 'メンバー' },
  'Y君': { name: 'Y君', role: 'メンバー' }
};

export class PhotoMetadataParser {
  private photos: PhotoMetadata[] = [];

  /**
   * raw_photosフォルダをスキャンしてメタデータを抽出
   */
  async scanPhotos(): Promise<PhotoMetadata[]> {
    try {
      const files = await fs.readdir(PATHS.rawPhotos);
      this.photos = [];

      for (const file of files) {
        if (this.isImageFile(file) && !this.isSystemFile(file)) {
          const metadata = this.parseFilename(file);
          if (metadata) {
            this.photos.push(metadata);
          }
        }
      }

      logger.info(`${this.photos.length} 枚の写真メタデータを読み込みました`);
      return this.photos;
    } catch (error) {
      logger.error('写真のスキャンに失敗しました');
      throw error;
    }
  }

  /**
   * ファイル名からメタデータを解析
   * フォーマット: イベント_人物_表情_ポーズ_詳細.jpg
   */
  private parseFilename(filename: string): PhotoMetadata | null {
    // logo.pngやifjukuthanks系画像はスキップ
    if (filename === 'logo.png' || filename.startsWith('ifjukuthanks')) {
      return null;
    }

    const parts = filename.replace(/\.(jpg|jpeg|png|JPG|JPEG|PNG)$/i, '').split('_');

    if (parts.length < 3) {
      return null;
    }

    const event = parts[0];
    const people: string[] = [];
    let expression = '';
    let pose = '';
    let description = '';

    // 人物、表情、ポーズ、詳細を抽出
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];

      // メンバー名かチェック
      if (MEMBER_INFO[part]) {
        people.push(part);
      } else if (this.isExpression(part)) {
        expression = part;
      } else if (this.isPose(part)) {
        pose = part;
      } else {
        // それ以外は詳細説明
        if (description) {
          description += ' ' + part;
        } else {
          description = part;
        }
      }
    }

    const category = this.determineCategory(event);

    return {
      filename,
      filepath: path.join(PATHS.rawPhotos, filename),
      event,
      people,
      expression,
      pose,
      description,
      category
    };
  }

  private isImageFile(filename: string): boolean {
    return /\.(jpg|jpeg|png)$/i.test(filename);
  }

  private isSystemFile(filename: string): boolean {
    return filename.startsWith('.') || filename === 'logo.png' || filename.startsWith('ifjukuthanks');
  }

  private isExpression(text: string): boolean {
    const expressions = ['笑顔', '真顔', '俯いている', '顔が見えない', '表情が見えない', '微笑', '上から目線', '横を向いている'];
    return expressions.includes(text);
  }

  private isPose(text: string): boolean {
    const poses = ['立っている', '座っている', '立ってピース', 'ピース', 'しゃがんでポーズ', 'しゃがんでポーズなし', '横向き', '斜めに立っている'];
    return poses.some(p => text.includes(p));
  }

  private determineCategory(event: string): PhotoMetadata['category'] {
    const info = Object.entries(EVENT_INFO).find(([key]) => event.includes(key));
    if (info) {
      switch (info[1].type) {
        case 'media':
        case 'competition':
        case 'event':
          return 'event';
        case 'education':
          return 'activity';
        case 'development':
          return 'activity';
        case 'team':
          return 'team';
      }
    }
    return 'activity';
  }

  /**
   * イベント別に写真をグループ化
   */
  async getPhotosByEvent(): Promise<Map<string, PhotoMetadata[]>> {
    if (this.photos.length === 0) {
      await this.scanPhotos();
    }

    const grouped = new Map<string, PhotoMetadata[]>();

    for (const photo of this.photos) {
      const eventKey = this.normalizeEventName(photo.event);
      if (!grouped.has(eventKey)) {
        grouped.set(eventKey, []);
      }
      grouped.get(eventKey)!.push(photo);
    }

    return grouped;
  }

  /**
   * イベント名を正規化
   */
  private normalizeEventName(event: string): string {
    for (const key of Object.keys(EVENT_INFO)) {
      if (event.includes(key)) {
        return key;
      }
    }
    return event;
  }

  /**
   * 活動報告用のトピックデータを生成
   */
  async generateActivityTopics(): Promise<{
    event: string;
    eventInfo: typeof EVENT_INFO[string];
    photos: PhotoMetadata[];
    suggestedCaption: string;
  }[]> {
    const groupedPhotos = await this.getPhotosByEvent();
    const topics = [];

    for (const [event, photos] of groupedPhotos) {
      const eventInfo = EVENT_INFO[event];
      if (!eventInfo) continue;

      // 写っている人物を集計
      const allPeople = new Set<string>();
      photos.forEach(p => p.people.forEach(person => allPeople.add(person)));
      const peopleList = Array.from(allPeople).join('、');

      // キャプションを生成
      const suggestedCaption = this.generateCaption(event, eventInfo, Array.from(allPeople), photos);

      topics.push({
        event,
        eventInfo,
        photos,
        suggestedCaption
      });
    }

    return topics;
  }

  /**
   * キャプションを生成
   */
  private generateCaption(
    event: string,
    eventInfo: typeof EVENT_INFO[string],
    people: string[],
    photos: PhotoMetadata[]
  ): string {
    const descriptions = photos
      .filter(p => p.description)
      .map(p => p.description)
      .slice(0, 3);

    let caption = `📸 ${eventInfo.name}\n\n`;
    caption += `${eventInfo.description}\n\n`;

    if (descriptions.length > 0) {
      caption += `✨ 活動内容\n`;
      descriptions.forEach(desc => {
        caption += `・${desc}\n`;
      });
      caption += '\n';
    }

    if (people.length > 0) {
      caption += `👥 参加メンバー: ${people.join('、')}\n\n`;
    }

    caption += eventInfo.hashtags.join(' ') + ' #if塾';

    return caption;
  }

  /**
   * 特定のイベントの写真をランダムに取得
   */
  async getRandomPhotoForEvent(eventKey: string): Promise<PhotoMetadata | null> {
    const groupedPhotos = await this.getPhotosByEvent();
    const photos = groupedPhotos.get(eventKey);

    if (!photos || photos.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * photos.length);
    return photos[randomIndex];
  }

  /**
   * 笑顔の写真を優先的に取得
   */
  async getSmilingPhotos(): Promise<PhotoMetadata[]> {
    if (this.photos.length === 0) {
      await this.scanPhotos();
    }

    return this.photos.filter(p =>
      p.expression === '笑顔' || p.expression === '微笑'
    );
  }
}

export const photoMetadataParser = new PhotoMetadataParser();
