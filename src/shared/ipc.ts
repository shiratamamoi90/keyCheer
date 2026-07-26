// IPC チャンネル定義:main ⇄ renderer の唯一の契約点。
// engine の共有型のみ参照し、providers・agent 実装には触れない(発動経路の境界を型レベルでも保つ)。
// チャンネル名は文字列定数で一元管理し、main/preload/renderer が同じ値を参照する。

import type { SpeedZone, CheerType, TimeOfDay, TriggerConfig, Stats } from "./types.js";

export const IpcChannel = {
  // renderer → main(invoke:双方向)
  GetTriggerConfig: "keycheer:get-trigger-config",
  UpdateTriggerConfig: "keycheer:update-trigger-config",
  GetStats: "keycheer:get-stats",
  // キャラ作成フォーム(changes/0010)。生成は含まず、プロフィールの保存と話者一覧のみ。
  SaveCharacter: "keycheer:save-character",
  GetSpeakers: "keycheer:get-speakers",
  GetCharacter: "keycheer:get-character",
  // プール・wav の生成(changes/0011)。生成はローカルのみ(Ollama / VOICEVOX)。
  StartGeneration: "keycheer:start-generation",
  CancelGeneration: "keycheer:cancel-generation",
  GenerationProgress: "keycheer:generation-progress",
  // main → renderer(send:片方向)
  CheerFired: "keycheer:cheer-fired",
  ConfigMigrated: "keycheer:config-migrated",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

// main → renderer: 応援発動時にポップアップへ渡すペイロード。
// 発動経路の産物 — providers に一切依存しない(プール + wav のみで成立)。
export interface CheerFiredPayload {
  count: number;
  kpm: number;
  speedZone: SpeedZone;
  timeOfDay: TimeOfDay;
  type: CheerType;
  messageId: string;
  message: string; // {milestone} 補間後の表示テキスト
  wavPath: string | null; // null = テキストのみ(wav 欠損 / baseline 定型文)
  popupDurationMs: number;
}

// main → renderer: 旧既定値(regular=100)からの移行通知(specs/data-model.md のマイグレーション)
export interface ConfigMigratedPayload {
  field: "regular";
  from: number;
  to: number;
}

// renderer → main への設定更新リクエスト(バリデーションは main 側 engine で行う)
export type UpdateTriggerConfigRequest = TriggerConfig;

// renderer ← main の統計スナップショット(表示用)
export type StatsSnapshot = Stats;

// renderer → main: キャラ作成フォームが保存するプロフィール(changes/0010)。
// プール・wav・画像は含まない(生成は別 change)。
export interface SaveCharacterRequest {
  name: string;
  personality: string;
  voicevoxSpeakerId: number;
}

export type SaveCharacterResult = { ok: true } | { ok: false; errors: string[] };

// renderer ← main: 話者一覧(VOICEVOX から取得。未起動なら unavailable)
export interface SpeakerOption {
  id: number;
  name: string;
  styleName: string;
}

export type GetSpeakersResult =
  | { ok: true; speakers: SpeakerOption[] }
  | { ok: false; reason: "unavailable" };

// main → renderer: 生成の進捗・完了・失敗(changes/0011)。
// 応援発動経路とは無関係のチャンネル。プロバイダー実装の型は載せない。
export type GenerationProgressPayload =
  | { type: "progress"; phase: "text" | "voice"; done: number; total: number }
  | { type: "done"; synthesized: number; missing: number }
  | { type: "failed"; reason: string };

// renderer ← main: 保存済みキャラの要約(未保存なら null)。
// 表示と生成に要る値だけ。imagePaths / generatedBy は渡さない。
export interface CharacterSummaryPayload {
  id: string;
  name: string;
  personality: string;
  voicevoxSpeakerId: number;
}

// renderer → main: 生成開始の応答(実際の進捗は GenerationProgress で流れる)
export type StartGenerationResult =
  | { ok: true }
  | { ok: false; reason: "already-running" | "no-character" };
