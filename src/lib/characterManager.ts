/**
 * キャラクター管理モジュール
 * 塾長・塾頭などのキャラクター情報を管理
 */
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import { PATHS } from './config.js';

// キャラクターの基本パス（assets/characters内）
const CHARACTER_BASE_PATH = path.join(PATHS.assets, 'characters');

// キャラクター情報
export interface Character {
  name: string;
  file: string;
  style: string;
  description: {
    ja: string;
    en: string;
  };
  personality: string;
  useFor: string[];
  promptReference: string;
  imagePath: string;
}

// キャラクター設定ファイルの型
interface CharacterConfig {
  characters: {
    jukucho: CharacterConfigEntry;
    jukuto: CharacterConfigEntry;
  };
  topic_character_mapping: Record<string, string>;
  default_character: string;
}

interface CharacterConfigEntry {
  name: string;
  file: string;
  style: string;
  description: {
    ja: string;
    en: string;
  };
  personality: string;
  use_for: string[];
  prompt_reference: string;
}

// キャラクターの役割
export type CharacterRole = '塾長' | '塾頭';

// 役割とキャラクターIDのマッピング
const ROLE_TO_ID: Record<CharacterRole, string> = {
  '塾長': 'jukucho',
  '塾頭': 'jukuto',
};

// 設定ファイルのキャッシュ
let configCache: CharacterConfig | null = null;

/**
 * キャラクター設定を読み込む
 */
async function loadCharacterConfig(): Promise<CharacterConfig> {
  if (configCache) {
    return configCache;
  }

  try {
    const configPath = path.join(CHARACTER_BASE_PATH, 'character_config.json');
    const content = await fs.readFile(configPath, 'utf-8');
    configCache = JSON.parse(content) as CharacterConfig;
    return configCache;
  } catch (error) {
    logger.error('キャラクター設定の読み込みに失敗');
    throw error;
  }
}

/**
 * キャラクター情報を取得
 */
export async function getCharacter(role: CharacterRole): Promise<Character | null> {
  try {
    const config = await loadCharacterConfig();
    const charId = ROLE_TO_ID[role] as keyof typeof config.characters;
    const charConfig = config.characters[charId];

    if (!charConfig) {
      logger.warn(`キャラクター設定が見つかりません: ${role}`);
      return null;
    }

    const imagePath = path.join(CHARACTER_BASE_PATH, charConfig.file);

    return {
      name: charConfig.name,
      file: charConfig.file,
      style: charConfig.style,
      description: charConfig.description,
      personality: charConfig.personality,
      useFor: charConfig.use_for,
      promptReference: charConfig.prompt_reference,
      imagePath,
    };
  } catch (error) {
    logger.error(`キャラクター読み込みエラー: ${role}`);
    return null;
  }
}

/**
 * キャラクターの外見説明を生成（英語）
 */
export function getCharacterAppearanceDescription(character: Character): string {
  return character.promptReference;
}

/**
 * キャラクターの外見説明を生成（日本語）
 */
export function getCharacterDescriptionJa(character: Character): string {
  return character.description.ja;
}

/**
 * キャラクターの性格説明を取得
 */
export function getCharacterPersonality(character: Character): string {
  return character.personality;
}

/**
 * カテゴリに基づいて適切なキャラクターを選択
 */
export async function getCharacterForCategory(category: string): Promise<Character | null> {
  const config = await loadCharacterConfig();
  const charId = config.topic_character_mapping[category] || config.default_character;

  if (charId === 'jukucho') {
    return getCharacter('塾長');
  } else {
    return getCharacter('塾頭');
  }
}

/**
 * 全キャラクターを取得
 */
export async function getAllCharacters(): Promise<Map<CharacterRole, Character>> {
  const characters = new Map<CharacterRole, Character>();

  for (const role of Object.keys(ROLE_TO_ID) as CharacterRole[]) {
    const character = await getCharacter(role);
    if (character) {
      characters.set(role, character);
    }
  }

  return characters;
}

/**
 * スライドごとにキャラクターを割り当て
 * 表紙: 塾長と塾頭が一緒に
 * 内容: 交互に塾長と塾頭
 */
export function assignCharactersToSlides(slideCount: number): CharacterRole[][] {
  const assignments: CharacterRole[][] = [];

  for (let i = 0; i < slideCount; i++) {
    if (i === 0) {
      // 表紙は両方
      assignments.push(['塾長', '塾頭']);
    } else {
      // 内容スライドは交互
      assignments.push([i % 2 === 1 ? '塾頭' : '塾長']);
    }
  }

  return assignments;
}
