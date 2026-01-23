/**
 * 画像品質評価モジュール
 * 生成された画像の品質をチェックし、問題があれば修正提案を行う
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import { getConfig } from './config.js';
import { logger } from './logger.js';

// 評価結果の型定義
export interface QualityCheckResult {
  isValid: boolean;
  score: number; // 0-100
  checks: {
    characterPresent: boolean;
    characterFeatures: boolean;
    backgroundValid: boolean;
    textPresent: boolean;
    textReadable: boolean;
    textComplete: boolean; // テキストが見切れていないか
    compositionValid: boolean;
  };
  issues: string[];
  suggestedFixes: string[];
  rawResponse?: string;
}

// キャラクター特徴の型定義
export interface CharacterFeatures {
  name: string;
  description: string;
  requiredElements: string[];
}

// 評価リクエストの型定義
export interface EvaluationRequest {
  imagePath: string;
  expectedCharacter: CharacterFeatures;
  expectedText: string[];
  expectedBackground: string;
  slideType: 'cover' | 'content';
}

export class ImageQualityEvaluator {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const config = getConfig();
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  /**
   * 画像の品質をチェック
   */
  async evaluateImage(request: EvaluationRequest): Promise<QualityCheckResult> {
    logger.info(`画像品質評価を開始: ${request.imagePath}`);

    try {
      // 画像をBase64で読み込み
      const imageData = await fs.readFile(request.imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = request.imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

      // 評価プロンプトを構築
      const prompt = this.buildEvaluationPrompt(request);

      // Gemini Vision APIで評価
      const result = await this.model.generateContent([
        {
          inlineData: {
            mimeType,
            data: base64Image,
          },
        },
        prompt,
      ]);

      const response = await result.response;
      const text = response.text();

      // 結果をパース
      return this.parseEvaluationResult(text, request);
    } catch (error) {
      logger.error(`画像評価エラー: ${error}`);
      return {
        isValid: false,
        score: 0,
        checks: {
          characterPresent: false,
          characterFeatures: false,
          backgroundValid: false,
          textPresent: false,
          textReadable: false,
          textComplete: false,
          compositionValid: false,
        },
        issues: ['評価処理でエラーが発生しました'],
        suggestedFixes: ['再生成を試みてください'],
      };
    }
  }

  /**
   * 評価プロンプトを構築
   */
  private buildEvaluationPrompt(request: EvaluationRequest): string {
    return `あなたは厳格な画像品質評価AIです。以下の基準でこの画像を厳しく評価し、JSON形式で結果を返してください。
少しでも問題があればfalseにしてください。曖昧な場合もfalseです。

【評価対象画像の要件】
- キャラクター: ${request.expectedCharacter.name}
- キャラクター特徴: ${request.expectedCharacter.description}
- 必須要素: ${request.expectedCharacter.requiredElements.join('、')}
- 期待するテキスト: ${request.expectedText.join('、')}
- 期待する背景: ${request.expectedBackground}
- スライドタイプ: ${request.slideType === 'cover' ? '表紙（キャッチーなデザイン）' : '内容スライド'}

【チェック項目 - 厳格に判定すること】

1. characterPresent: キャラクターが画像内に存在するか
   - false条件: 背景のみの画像、キャラクターが見当たらない

2. characterFeatures: キャラクターの特徴が正しく描画されているか
   - false条件: 必須要素が欠けている、特徴が異なる

3. backgroundValid: 背景が適切に描画されているか
   - false条件: 真っ白/単色の背景、背景がほぼ無い、グラデーションのみ

4. textPresent: 意味のある日本語テキストが画像内に存在するか
   - true条件: 意味のある日本語の文章・フレーズが存在する（例：「販売戦略」「効果的な」など）
   - false条件:
     * テキストが全くない
     * 英語のみ
     * 断片的な1文字や記号のみ（例：「夸」「持」「</> 」のような意味不明な文字の羅列）
     * アイコンや記号だけでテキストがない
     * 意味を成さない文字の組み合わせ

5. textReadable: テキストが判読可能か
   - false条件: 文字化けしている、ぼやけて読めない、背景と同化して見えない

6. textComplete: 【最重要・厳格判定】テキストが完全に表示されているか（見切れていないか）
   - false条件（1つでも該当すればfalse）:
     * テキストの最後の1文字でも画像端で途切れている
     * 例：「コンセプト」が「コンセプ」になっている → false
     * 例：「戦略」が「戦」になっている → false
     * 例：「積極的に」が「積極」になっている → false
     * 例：「スタンプ」が「スタ」や「スタン」になっている → false
     * 文字の右端や下端が画像外にはみ出している
     * 単語が意味的に完結していない
   - true条件: すべてのテキストが完全な単語として表示され、1文字も欠けていない
   - 判定のコツ: 画像の右端・左端・上端・下端を注意深く確認し、テキストが枠に接触していないか確認する

7. compositionValid: 構図が適切か
   - false条件: キャラクターが見切れている、極端に小さい

【出力形式】
以下のJSON形式で回答してください。
{
  "checks": {
    "characterPresent": true/false,
    "characterFeatures": true/false,
    "backgroundValid": true/false,
    "textPresent": true/false,
    "textReadable": true/false,
    "textComplete": true/false,
    "compositionValid": true/false
  },
  "score": 0-100の数値,
  "issues": ["問題点1", "問題点2"],
  "suggestedFixes": ["修正提案1（プロンプトへの追加指示）", "修正提案2"]
}

【重要な注意 - 必ず守ること】
- textCompleteは特に厳しくチェックすること
- テキストの最後の1文字でも見切れていたらtextComplete=false
- 画像の端にテキストが接触していたらtextComplete=false
- 「〜戦」「〜的」「〜スタ」「〜コンセプ」のように単語が途中で終わっていたらtextComplete=false
- textPresentは意味のある文章・フレーズが必要。断片的な文字やアイコンのみはfalse
- 迷ったら必ずfalseにすること
- 品質が低い画像を通過させるより、厳しく判定して再生成させる方が良い

必ずJSON形式のみで回答してください。`;
  }

  /**
   * 評価結果をパース
   */
  private parseEvaluationResult(text: string, request: EvaluationRequest): QualityCheckResult {
    try {
      // JSONを抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON形式の結果が見つかりません');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const checks = {
        characterPresent: Boolean(parsed.checks?.characterPresent),
        characterFeatures: Boolean(parsed.checks?.characterFeatures),
        backgroundValid: Boolean(parsed.checks?.backgroundValid),
        textPresent: Boolean(parsed.checks?.textPresent),
        textReadable: Boolean(parsed.checks?.textReadable),
        textComplete: Boolean(parsed.checks?.textComplete),
        compositionValid: Boolean(parsed.checks?.compositionValid),
      };

      // 全チェックがOKかどうか
      const isValid = Object.values(checks).every(v => v);

      return {
        isValid,
        score: Number(parsed.score) || 0,
        checks,
        issues: parsed.issues || [],
        suggestedFixes: parsed.suggestedFixes || [],
        rawResponse: text,
      };
    } catch (error) {
      logger.warn(`評価結果のパースに失敗: ${error}`);
      return {
        isValid: false,
        score: 0,
        checks: {
          characterPresent: false,
          characterFeatures: false,
          backgroundValid: false,
          textPresent: false,
          textReadable: false,
          textComplete: false,
          compositionValid: false,
        },
        issues: ['評価結果のパースに失敗'],
        suggestedFixes: [],
        rawResponse: text,
      };
    }
  }

  /**
   * 修正プロンプトを生成
   *
   * 【重要】リトライ時は指示を積み重ねない
   * 複雑すぎるプロンプトは画像生成AIを混乱させ、品質が低下する
   * 最も重要な1つの問題だけに焦点を当てた短い追加指示を使う
   */
  generateFixedPrompt(
    originalPrompt: string,
    checkResult: QualityCheckResult,
    characterFeatures: CharacterFeatures
  ): string {
    // 優先順位: テキスト > キャラクター > 背景
    // 1つの問題だけを短く指摘（長い指示は逆効果）

    let prefix = '';

    // テキスト問題が最優先
    if (!checkResult.checks.textPresent) {
      prefix = '【重要】大きな日本語テキストを画像上部に必ず表示。\n\n';
    } else if (!checkResult.checks.textComplete) {
      prefix = '【重要】テキストは画像中央に配置し左右20%余白を確保。見切れ禁止。\n\n';
    }
    // キャラクター問題
    else if (!checkResult.checks.characterPresent) {
      prefix = '【重要】キャラクターを画像中央に大きく描く。背景のみ禁止。\n\n';
    } else if (!checkResult.checks.characterFeatures) {
      const features = characterFeatures.requiredElements.slice(0, 2).join('、');
      prefix = `【重要】キャラクター特徴: ${features}を必ず描く。\n\n`;
    }
    // 背景問題（低優先度）
    else if (!checkResult.checks.backgroundValid) {
      prefix = '【重要】背景にPC画面やデータグラフを追加。真っ白禁止。\n\n';
    }

    return prefix + originalPrompt;
  }
}

export const imageQualityEvaluator = new ImageQualityEvaluator();
