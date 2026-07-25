// IPC チャンネル定義:main ⇄ renderer の唯一の契約点。
// engine の共有型のみ参照し、providers・agent 実装には触れない(発動経路の境界を型レベルでも保つ)。
// チャンネル名は文字列定数で一元管理し、main/preload/renderer が同じ値を参照する。

import type { SpeedZone, CheerType, TimeOfDay, TriggerConfig, Stats } from "./types.js";

export const IpcChannel = {
  // renderer → main(invoke:双方向)
  GetTriggerConfig: "keycheer:get-trigger-config",
  UpdateTriggerConfig: "keycheer:update-trigger-config",
  GetStats: "keycheer:get-stats",
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
