/**
 * デザインルール管理モジュール
 * design-rules.jsonを読み込み、全ての生成処理で参照する
 */
import fs from 'fs/promises';
import path from 'path';
import { PATHS } from './config.js';
import { logger } from './logger.js';

// デザインルールの型定義
export interface DesignRules {
  version: string;
  lastUpdated: string;
  description: string;
  contentStyle: {
    noEmoji: {
      enabled: boolean;
      description: string;
      rules: string[];
    };
    tone: {
      style: string;
      description: string;
      rules: string[];
      avoidWords: string[];
      preferWords: string[];
    };
  };
  imageGeneration: {
    strictNoText: {
      enabled: boolean;
      description: string;
      rules: string[];
      promptSuffix: string;
    };
    style: {
      format: string;
      aspectRatio: string;
      quality: string;
      colorScheme: string;
    };
  };
  contentRules: {
    activityReports: {
      mustUseRealPhotos: boolean;
      description: string;
      rules: string[];
    };
    announcements: {
      description: string;
      rules: string[];
    };
    columns: {
      description: string;
      rules: string[];
    };
  };
  trendResearch: {
    enabled: boolean;
    description: string;
    requirements: string[];
    outdatedTopics: string[];
    currentTopics: {
      ai: string[];
      business: string[];
      education: string[];
    };
  };
  members: {
    description: string;
    list: {
      name: string;
      role: string;
      aliases: string[];
    }[];
  };
  htmlTemplate: {
    description: string;
    rules: string[];
  };
}

class DesignRulesManager {
  private rules: DesignRules | null = null;
  private rulesPath: string;

  constructor() {
    this.rulesPath = path.join(PATHS.data, 'design-rules.json');
  }

  /**
   * デザインルールを読み込む
   */
  async loadRules(): Promise<DesignRules> {
    if (this.rules) {
      return this.rules;
    }

    try {
      const data = await fs.readFile(this.rulesPath, 'utf-8');
      this.rules = JSON.parse(data) as DesignRules;
      logger.info(`デザインルール v${this.rules.version} を読み込みました`);
      return this.rules;
    } catch (error) {
      logger.error('デザインルールの読み込みに失敗しました');
      throw error;
    }
  }

  /**
   * 画像生成用のプロンプトサフィックスを取得
   * 文字禁止ルールを強制する
   */
  async getImagePromptSuffix(): Promise<string> {
    const rules = await this.loadRules();
    if (rules.imageGeneration.strictNoText.enabled) {
      return '\n\n' + rules.imageGeneration.strictNoText.promptSuffix;
    }
    return '';
  }

  /**
   * 文字禁止の追加指示を取得
   */
  async getNoTextInstructions(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.imageGeneration.strictNoText.rules;
  }

  /**
   * 活動報告で実際の写真を使用すべきか
   */
  async shouldUseRealPhotosForActivity(): Promise<boolean> {
    const rules = await this.loadRules();
    return rules.contentRules.activityReports.mustUseRealPhotos;
  }

  /**
   * 最新のAIトピック一覧を取得
   */
  async getCurrentAITopics(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.trendResearch.currentTopics.ai;
  }

  /**
   * 最新のビジネストピック一覧を取得
   */
  async getCurrentBusinessTopics(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.trendResearch.currentTopics.business;
  }

  /**
   * 最新の教育トピック一覧を取得
   */
  async getCurrentEducationTopics(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.trendResearch.currentTopics.education;
  }

  /**
   * 古いトピック一覧を取得（使用禁止）
   */
  async getOutdatedTopics(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.trendResearch.outdatedTopics;
  }

  /**
   * メンバー情報を取得
   */
  async getMembers(): Promise<DesignRules['members']['list']> {
    const rules = await this.loadRules();
    return rules.members.list;
  }

  /**
   * トレンドリサーチの要件を取得
   */
  async getTrendResearchRequirements(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.trendResearch.requirements;
  }

  /**
   * コンテンツスタイルルールを取得
   */
  async getContentStyleRules(): Promise<DesignRules['contentStyle']> {
    const rules = await this.loadRules();
    return rules.contentStyle;
  }

  /**
   * 避けるべき言葉のリストを取得
   */
  async getAvoidWords(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.contentStyle.tone.avoidWords;
  }

  /**
   * 推奨する言葉のリストを取得
   */
  async getPreferWords(): Promise<string[]> {
    const rules = await this.loadRules();
    return rules.contentStyle.tone.preferWords;
  }

  /**
   * コンテンツ生成用のスタイル指示を取得
   */
  async getContentStyleInstructions(): Promise<string> {
    const rules = await this.loadRules();
    const style = rules.contentStyle;

    return `
【文体ルール - 必ず守ること】
${style.noEmoji.enabled ? '- 絵文字は使用禁止（タイトル、見出し、本文すべてで禁止）' : ''}
- 文体: ${style.tone.description}
${style.tone.rules.map(r => `- ${r}`).join('\n')}

【禁止ワード】以下の言葉は絶対に使用しない:
${style.tone.avoidWords.join('、')}

【推奨ワード】代わりに以下の言葉を使用する:
${style.tone.preferWords.join('、')}
    `.trim();
  }

  /**
   * ルールの強制適用チェック
   */
  async validateImagePrompt(prompt: string): Promise<string> {
    const rules = await this.loadRules();

    // 文字禁止ルールを追加
    if (rules.imageGeneration.strictNoText.enabled) {
      const suffix = rules.imageGeneration.strictNoText.promptSuffix;
      if (!prompt.includes(suffix)) {
        return prompt + '\n\n' + suffix;
      }
    }

    return prompt;
  }

  /**
   * デザインルールの全文を取得（ログ用）
   */
  async getRulesSummary(): Promise<string> {
    const rules = await this.loadRules();
    return `
=== デザインルール v${rules.version} ===
更新日: ${rules.lastUpdated}

【画像生成】
- 文字禁止: ${rules.imageGeneration.strictNoText.enabled ? '有効' : '無効'}
- ${rules.imageGeneration.strictNoText.rules.join('\n- ')}

【活動報告】
- 実写真必須: ${rules.contentRules.activityReports.mustUseRealPhotos ? 'はい' : 'いいえ'}

【最新トピック】
AI: ${rules.trendResearch.currentTopics.ai.slice(0, 3).join(', ')}...
ビジネス: ${rules.trendResearch.currentTopics.business.slice(0, 3).join(', ')}...
================================
`;
  }
}

export const designRules = new DesignRulesManager();
