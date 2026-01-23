/**
 * NotebookLM連携モジュール
 * 文体・事業情報をNotebookLMから取得
 * 必ず毎回の投稿生成時に実行すること
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

// NotebookLMスキルのパス（環境変数で上書き可能）
const NOTEBOOKLM_SKILL_PATH = process.env.NOTEBOOKLM_SKILL_PATH ||
  '/Users/takasaki19841121/Desktop/ifJukuManager/notebooklm-skill-master';

/**
 * NotebookLMスキルが利用可能かチェック
 */
function isNotebookLmAvailable(): boolean {
  const runPyPath = path.join(NOTEBOOKLM_SKILL_PATH, 'scripts', 'run.py');
  try {
    return fs.existsSync(runPyPath);
  } catch {
    return false;
  }
}

export interface BusinessInfo {
  brandVoice: string;        // 文体・トーン
  businessDescription: string; // 事業内容
  targetAudience: string;    // ターゲット層
  keyValues: string[];       // 重要な価値観
  writingStyle: string;      // 執筆スタイル
}

export class NotebookLmClient {
  /**
   * NotebookLMにクエリを送信
   */
  private async query(question: string): Promise<string> {
    return new Promise((resolve, reject) => {
      logger.info(`NotebookLMにクエリ中: ${question.slice(0, 50)}...`);

      const process = spawn('python', [
        path.join(NOTEBOOKLM_SKILL_PATH, 'scripts', 'run.py'),
        'ask_question.py',
        '--question', question,
      ], {
        cwd: NOTEBOOKLM_SKILL_PATH,
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          logger.error(`NotebookLMクエリエラー: ${stderr}`);
          reject(new Error(`NotebookLM query failed: ${stderr}`));
        } else {
          // 回答部分を抽出（末尾のフォローアップ質問プロンプトを除去）
          const answer = stdout.split('EXTREMELY IMPORTANT:')[0].trim();
          logger.success('NotebookLMから回答を取得');
          resolve(answer);
        }
      });

      process.on('error', (error) => {
        logger.error(`NotebookLMプロセスエラー: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * 認証状態を確認
   */
  async checkAuth(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn('python', [
        path.join(NOTEBOOKLM_SKILL_PATH, 'scripts', 'run.py'),
        'auth_manager.py',
        'status',
      ], {
        cwd: NOTEBOOKLM_SKILL_PATH,
      });

      let stdout = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.on('close', (code) => {
        const isAuthenticated = stdout.includes('authenticated') || stdout.includes('Authenticated');
        resolve(isAuthenticated);
      });

      process.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * if塾の文体・事業情報を取得
   * 必ず毎回の投稿生成前に呼び出すこと
   */
  async getBusinessInfo(): Promise<BusinessInfo> {
    logger.info('=== NotebookLMから文体・事業情報を取得 ===');

    // NotebookLMスキルが利用可能かチェック
    if (!isNotebookLmAvailable()) {
      logger.warn(`NotebookLMスキルが見つかりません: ${NOTEBOOKLM_SKILL_PATH}`);
      logger.warn('フォールバック情報を使用します。');
      return this.getFallbackBusinessInfo();
    }

    // 認証確認
    const isAuth = await this.checkAuth();
    if (!isAuth) {
      logger.warn('NotebookLM認証が必要です。フォールバック情報を使用します。');
      return this.getFallbackBusinessInfo();
    }

    try {
      // 文体・トーンを取得
      const brandVoiceQuery = `if塾のInstagram投稿における文体やトーン、言葉遣いのルールを教えてください。
絵文字の使用ルール、禁止されている表現、推奨される表現なども含めてください。`;
      const brandVoice = await this.query(brandVoiceQuery);

      // 事業内容を取得
      const businessQuery = `if塾の事業内容、提供しているサービス、特徴を教えてください。
プログラミング教室としての強み、AI開発サービスの内容も含めてください。`;
      const businessDescription = await this.query(businessQuery);

      // ターゲット層を取得
      const audienceQuery = `if塾のターゲット層は誰ですか？
Instagramでリーチしたい人物像を具体的に教えてください。`;
      const targetAudience = await this.query(audienceQuery);

      // 重要な価値観を取得
      const valuesQuery = `if塾が大切にしている価値観、ミッション、ビジョンを教えてください。
投稿で伝えたいメッセージの核となる部分です。`;
      const valuesResponse = await this.query(valuesQuery);
      const keyValues = valuesResponse.split('\n').filter(line => line.trim().length > 0).slice(0, 5);

      // 執筆スタイルを取得
      const styleQuery = `if塾のブログやSNS投稿で使用する執筆スタイルを教えてください。
文章の長さ、専門用語の使い方、読者への呼びかけ方などのルールです。`;
      const writingStyle = await this.query(styleQuery);

      logger.success('NotebookLMから情報取得完了');

      return {
        brandVoice,
        businessDescription,
        targetAudience,
        keyValues,
        writingStyle,
      };
    } catch (error) {
      logger.error(`NotebookLM情報取得エラー: ${error}`);
      logger.warn('フォールバック情報を使用します');
      return this.getFallbackBusinessInfo();
    }
  }

  /**
   * フォールバック用の事業情報
   * NotebookLMにアクセスできない場合に使用
   */
  private getFallbackBusinessInfo(): BusinessInfo {
    return {
      brandVoice: `
【文体ルール】
- 絵文字禁止（完全禁止）
- 丁寧だが堅すぎない、親しみやすいビジネス文体
- 「です・ます」調で統一
- 過度な煽りや誇張表現は禁止
- 具体的な数値やデータを重視
- 専門用語は平易に説明

【禁止表現】
- 「驚愕」「衝撃」「ヤバい」などの過度な表現
- 「絶対に」「必ず」などの断言
- 競合他社の誹謗中傷
      `.trim(),
      businessDescription: `
if塾は、子供向けプログラミング教室とAI開発サービスを提供する事業者です。

【プログラミング教室】
- 対象: 小学生〜高校生
- 内容: Scratch、Python、Web開発、AI入門
- 特徴: 個別指導、実践的なプロジェクト

【AI開発サービス】
- 企業向けAI導入支援
- カスタムAIソリューション開発
- Claude、GPT等のLLM活用コンサルティング
      `.trim(),
      targetAudience: `
- 子供にプログラミングを学ばせたい保護者
- AI時代の教育に関心のある保護者
- AI導入を検討している中小企業経営者
- 最新テクノロジーに興味のあるビジネスパーソン
      `.trim(),
      keyValues: [
        '実践的なスキルを身につける',
        'AI時代に対応できる人材を育てる',
        'テクノロジーを楽しく学ぶ',
        '個々のペースに合わせた指導',
        '最新技術への常にアップデート',
      ],
      writingStyle: `
- 1文は短めに（40文字以内を目安）
- 箇条書きを積極的に活用
- 具体的な例を必ず含める
- 専門用語には補足説明を付ける
- CTAは控えめに、押し付けがましくない
      `.trim(),
    };
  }

  /**
   * 特定のトピックに関する情報を取得
   */
  async getTopicInfo(topic: string): Promise<string> {
    const query = `${topic}について、if塾の視点から説明してください。
どのように活用できるか、どのようなメリットがあるかを含めてください。`;

    try {
      return await this.query(query);
    } catch (error) {
      logger.warn(`トピック情報取得失敗: ${topic}`);
      return '';
    }
  }
}

export const notebookLmClient = new NotebookLmClient();
