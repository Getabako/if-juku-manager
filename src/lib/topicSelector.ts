/**
 * トピック選択モジュール
 * topics.json からトピックを選択・管理
 */
import fs from 'fs/promises';
import { PATHS } from './config.js';
import { logger } from './logger.js';
import type { Topic, TopicsData } from './types.js';

export class TopicSelector {
  private topicsData: TopicsData | null = null;

  /**
   * topics.json を読み込み
   */
  async loadTopics(): Promise<TopicsData> {
    if (this.topicsData) {
      return this.topicsData;
    }

    try {
      const data = await fs.readFile(PATHS.topics, 'utf-8');
      this.topicsData = JSON.parse(data) as TopicsData;
      logger.info(`${this.topicsData.topics.length} 件のトピックを読み込みました`);
      return this.topicsData;
    } catch (error) {
      logger.error('topics.json の読み込みに失敗しました');
      throw error;
    }
  }

  /**
   * 次のトピックを取得（順次またはランダム）
   */
  async getNextTopic(): Promise<Topic> {
    const data = await this.loadTopics();
    const { topics, settings } = data;

    if (topics.length === 0) {
      throw new Error('トピックが見つかりません');
    }

    let selectedTopic: Topic;
    let newIndex: number;

    if (settings.rotationMode === 'random') {
      // ランダム選択
      newIndex = Math.floor(Math.random() * topics.length);
      selectedTopic = topics[newIndex];
    } else {
      // 順次選択
      newIndex = (settings.lastUsedIndex + 1) % topics.length;
      selectedTopic = topics[newIndex];
    }

    // 使用したインデックスを更新
    await this.updateLastUsedIndex(newIndex);

    logger.info(`トピックを選択: ${selectedTopic.title} (${selectedTopic.category})`);
    return selectedTopic;
  }

  /**
   * 特定のIDのトピックを取得
   */
  async getTopicById(id: string): Promise<Topic | null> {
    const data = await this.loadTopics();
    return data.topics.find((t) => t.id === id) || null;
  }

  /**
   * カテゴリでフィルタしてトピックを取得
   */
  async getTopicsByCategory(category: string): Promise<Topic[]> {
    const data = await this.loadTopics();
    return data.topics.filter((t) =>
      t.category.toLowerCase().includes(category.toLowerCase())
    );
  }

  /**
   * 最後に使用したインデックスを更新
   */
  private async updateLastUsedIndex(index: number): Promise<void> {
    if (!this.topicsData) {
      return;
    }

    this.topicsData.settings.lastUsedIndex = index;

    try {
      await fs.writeFile(
        PATHS.topics,
        JSON.stringify(this.topicsData, null, 2),
        'utf-8'
      );
      logger.debug(`lastUsedIndex を ${index} に更新しました`);
    } catch (error) {
      logger.warn('lastUsedIndex の更新に失敗しました');
    }
  }

  /**
   * 新しいトピックを追加
   */
  async addTopic(topic: Topic): Promise<void> {
    const data = await this.loadTopics();

    // 重複チェック
    if (data.topics.some((t) => t.id === topic.id)) {
      throw new Error(`トピックID "${topic.id}" は既に存在します`);
    }

    data.topics.push(topic);

    await fs.writeFile(PATHS.topics, JSON.stringify(data, null, 2), 'utf-8');
    this.topicsData = data;

    logger.success(`トピックを追加しました: ${topic.title}`);
  }

  /**
   * ローテーションモードを切り替え
   */
  async setRotationMode(mode: 'sequential' | 'random'): Promise<void> {
    const data = await this.loadTopics();
    data.settings.rotationMode = mode;

    await fs.writeFile(PATHS.topics, JSON.stringify(data, null, 2), 'utf-8');
    this.topicsData = data;

    logger.info(`ローテーションモードを "${mode}" に変更しました`);
  }

  /**
   * 全トピックの一覧を取得
   */
  async listAllTopics(): Promise<{ id: string; title: string; category: string }[]> {
    const data = await this.loadTopics();
    return data.topics.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
    }));
  }
}

export const topicSelector = new TopicSelector();
