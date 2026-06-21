// 共有型(main / renderer / engine の境界)。
// 各 union のランタイム配列(SPEED_ZONES など)は engine からの単一参照点。

export type SpeedZone = "slow" | "normal" | "fast";
export type CheerType = "regular" | "milestone";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type TextProviderId = "local-ollama" | "openai" | "anthropic";
export type VoiceProviderId = "local-voicevox" | "openai-tts" | "elevenlabs";
export type ImageProviderId = "local-sdcpp" | "openai-dalle" | "stability-ai";

// 各 union のランタイム配列。順序は決定的(specs/data-model.md の 24 シナリオ列挙順と一致)。
export const SPEED_ZONES = ["slow", "normal", "fast"] as const satisfies readonly SpeedZone[];
export const CHEER_TYPES = ["regular", "milestone"] as const satisfies readonly CheerType[];
export const TIMES_OF_DAY = [
  "morning",
  "afternoon",
  "evening",
  "night",
] as const satisfies readonly TimeOfDay[];

export interface TriggerConfig {
  regular: number; // 1..10000
  milestones: number[]; // 各 1 以上・昇順・重複なし・最大 20、空配列許容
  activeThresholdSec: number; // 5..600
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  regular: 50,
  milestones: [1000, 5000, 10000, 50000, 100000],
  activeThresholdSec: 60,
};
