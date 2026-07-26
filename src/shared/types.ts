// 共有型(main / renderer / engine の境界)。
// 各 union のランタイム配列(SPEED_ZONES など)は engine からの単一参照点。

export type SpeedZone = "slow" | "normal" | "fast";
export type CheerType = "regular" | "milestone";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type TextProviderId = "local-ollama" | "openai" | "anthropic";
export type VoiceProviderId = "local-voicevox" | "openai-tts" | "elevenlabs";
export type ImageProviderId = "local-sdcpp" | "openai-dalle" | "stability-ai";
export type ProviderId = TextProviderId | VoiceProviderId | ImageProviderId;

// 各プロバイダー union のランタイム配列(閉じた union の単一参照点。specs/integrations.md)
export const TEXT_PROVIDER_IDS = [
  "local-ollama",
  "openai",
  "anthropic",
] as const satisfies readonly TextProviderId[];
export const VOICE_PROVIDER_IDS = [
  "local-voicevox",
  "openai-tts",
  "elevenlabs",
] as const satisfies readonly VoiceProviderId[];
export const IMAGE_PROVIDER_IDS = [
  "local-sdcpp",
  "openai-dalle",
  "stability-ai",
] as const satisfies readonly ImageProviderId[];

export interface ProviderSelection {
  text: TextProviderId;
  voice: VoiceProviderId;
  image: ImageProviderId;
}

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

// 統計データ契約(specs/data-model.md「統計データ」)。main が永続化、renderer が表示に使う。
// キー入力の「内容」は一切含めない(プライバシー方針:種類のカウントと集計値のみ)。
export interface CheerHistoryEntry {
  timestamp: string; // ISO 8601
  count: number;
  kpm: number;
  speedZone: SpeedZone;
  type: CheerType;
  timeOfDay: TimeOfDay;
  messageId: string;
  message: string; // {milestone} 補間後の表示テキスト
}

export interface Stats {
  totalKeyCount: number;
  totalActiveSeconds: number;
  dailyCounts: Record<string, number>; // "YYYY-MM-DD" -> count
  dailyActiveSeconds: Record<string, number>;
  cheerHistory: CheerHistoryEntry[];
}

export const EMPTY_STATS: Stats = {
  totalKeyCount: 0,
  totalActiveSeconds: 0,
  dailyCounts: {},
  dailyActiveSeconds: {},
  cheerHistory: [],
};

// キャラクターデータ契約(specs/data-model.md「設定データ」)。
// キャラ作成フロー本体(プール・wav 生成)は別 change。ここは main が
// 「作成済みか」を判定するために読む最小限の形のみ定義する。
export interface Character {
  name: string;
  personality: string;
  imagePaths: Record<string, string>;
  voicevoxSpeakerId: number;
  generatedBy: {
    text: TextProviderId;
    voice: VoiceProviderId;
    image: ImageProviderId;
  };
}

// オンボーディング状態(changes/0008-main-window-character-creation/spec.md)。
// メインウィンドウの自動表示可否のみを持つ(キャラ作成の進捗そのものは character 側で判定)。
export interface Onboarding {
  skipMainWindowAutoShow: boolean;
}

export const DEFAULT_ONBOARDING: Onboarding = {
  skipMainWindowAutoShow: false,
};
