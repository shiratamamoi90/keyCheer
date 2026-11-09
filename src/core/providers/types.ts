// providers/types: テキスト/音声/画像 生成プロバイダーのインターフェース(型契約のみ)。
// spec: 論点 0016(生成手段の抽象化)/ docs/integrations.md
// 実装(Ollama/VOICEVOX/sd.cpp/外部 API)は src/agent 側。core には型契約だけを置く。
// 予算(timeoutMs)・シードは引数で受ける anytime 設計(impl-rules.md)。
// 注意: このモジュールは応援発動経路から import 禁止(eslint.config.js)。

import type { TextProviderId, VoiceProviderId, ImageProviderId } from "../shared/types.js";

export interface TextGenerationRequest {
  systemPrompt: string;
  scenarioKey: string; // 例: "fast_regular_evening"(messagePool の BucketKey と同形)
  count: number; // 生成する文数。値は呼び出し側が決める(ここに既定値を書くと二重管理になる)
  seed?: number; // 再現性のためのシード(対応プロバイダーのみ)
  timeoutMs: number; // 予算。超過前に呼び出し側がフォールバック
}

export interface TextGenerator {
  readonly id: TextProviderId;
  generateMessages(request: TextGenerationRequest): Promise<string[]>;
}

export interface VoiceSynthesisRequest {
  text: string; // 1 文(30 字以内の契約はプール側で担保)
  speakerId?: number; // VOICEVOX 話者 ID 等、プロバイダー固有の話者指定
  timeoutMs: number;
}

export interface VoiceSynthesizer {
  readonly id: VoiceProviderId;
  synthesize(request: VoiceSynthesisRequest): Promise<Uint8Array>; // wav バイト列
}

// 画像タグの要求(論点 0036)。テキストプロバイダーに、画像のプロンプトに入れる英語の短い語句を出させる。
// セリフの生成(TextGenerator)と型を分けるのは、応答スキーマが違い({ tags } と { messages })、
// セリフだけを使う呼び出し側(計測・既存の偽物)に画像タグの実装を強いないため。
export interface ImageTagRequest {
  prompt: string;
  seed?: number;
  timeoutMs: number;
}

export interface ImageTagGenerator {
  readonly id: TextProviderId;
  // 応答はそのまま返す(JSON 文字列または解析済みのオブジェクト)。検証と連結は core/characterImage が持つ
  generateImageTags(request: ImageTagRequest): Promise<unknown>;
}

export interface ImageGenerationRequest {
  prompt: string;
  seed: number; // 同一シード + 同一プロンプト = 同一画像(docs/integrations.md)
  count: number; // 同じプロンプトで作る枚数。キャラ画像は 1 枚ずつ要求する(論点 0036)
  width: number;
  height: number;
  timeoutMs: number;
}

export interface ImageGenerator {
  readonly id: ImageProviderId;
  generateImages(request: ImageGenerationRequest): Promise<Uint8Array[]>;
}
