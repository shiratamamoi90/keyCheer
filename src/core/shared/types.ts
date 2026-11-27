// 共有型(main / renderer / core の境界)。
// 各 union のランタイム配列(SPEED_ZONES など)は core からの単一参照点。

import { DEFAULT_OLLAMA_ENDPOINT, DEFAULT_VOICEVOX_ENDPOINT } from "./localEndpoints.js";

export type SpeedZone = "slow" | "normal" | "fast";
export type CheerType = "regular" | "milestone";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

// プロバイダー識別子(閉じた union。docs/integrations.md)。生成はローカルだけで、種別ごとに 1 つ(論点 0054)。
// 利用者は選ばない。値は生成元の記録(generatedBy)と、生成器の id に使う
export type TextProviderId = "local-ollama";
export type VoiceProviderId = "local-voicevox";
export type ImageProviderId = "local-sdcpp";
export type ProviderId = TextProviderId | VoiceProviderId | ImageProviderId;

export const TEXT_PROVIDER_IDS = ["local-ollama"] as const satisfies readonly TextProviderId[];
export const VOICE_PROVIDER_IDS = ["local-voicevox"] as const satisfies readonly VoiceProviderId[];
export const IMAGE_PROVIDER_IDS = ["local-sdcpp"] as const satisfies readonly ImageProviderId[];

// 各 union のランタイム配列。順序は決定的(docs/data-model.md の 24 シナリオ列挙順と一致)。
export const SPEED_ZONES = ["slow", "normal", "fast"] as const satisfies readonly SpeedZone[];
export const CHEER_TYPES = ["regular", "milestone"] as const satisfies readonly CheerType[];
export const TIMES_OF_DAY = [
  "morning",
  "afternoon",
  "evening",
  "night",
] as const satisfies readonly TimeOfDay[];

export interface TriggerConfig {
  regular: number;
  // 累計がこの倍数になるたびに節目の応援(論点 0071)。regular より大きい
  milestoneInterval: number;
  isMilestoneEnabled: boolean;
}

// トリガー設定の値域(docs/data-model.md S0071_07)。main の検証と設定画面の入力の両方が使う
// (片方だけ変えると、画面で作れる値を main が拒否する)。節目の下限は regular + 1 で、値ではなく関係で決まる
export const TRIGGER_RANGES = {
  regular: { min: 1, max: 10_000 },
  // 上限は旧既定の最大の節目(論点 0071)。regular の上限 10000 でも節目を選べる
  milestoneInterval: { max: 100_000 },
} as const;

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  regular: 50,
  // 論点 0071 節目を 1 つの回数にし、その倍数ごとに繰り返す(論点 0069 の最初の節目 250 を引き継ぐ)
  milestoneInterval: 250,
  isMilestoneEnabled: true,
};

// 統計データ契約(docs/data-model.md「統計データ」)。応援の発動判定に使う累計カウントだけを持つ(論点 0080 / 0081)。
// キー入力の「内容」は一切含めない(プライバシー方針)。
export interface Stats {
  totalKeyCount: number;
}

export const EMPTY_STATS: Stats = {
  totalKeyCount: 0,
};

// キャラクターデータ契約(docs/data-model.md「設定データ」)。
// キャラ作成フロー本体(プール・wav 生成)は別の論点。ここは main が
// 「作成済みか」を判定するために読む最小限の形のみ定義する。
export interface Character {
  // 保存時に採番される不変 ID(論点 0020)。pool.json と voices/ のディレクトリ名になるため
  // 名前には依存させない — 名前を変えるたびに生成済みの wav が迷子になるのを防ぐ。
  id: string;
  name: string;
  personality: string;
  imagePaths: Record<string, string>;
  voicevoxSpeakerId: number;
  // 生成を一度も完了していないキャラ(旧バージョン JSON を含む)は持たない(S0022_09)。
  generatedBy?: GeneratedBy;
}

// 生成元プロバイダー(論点 0022)。欠損なく完了した種別だけが現れる。
// 全フィールド任意なのは、画像生成が未実装でも text / voice を記録できるようにするため。
export interface GeneratedBy {
  text?: TextProviderId;
  voice?: VoiceProviderId;
  image?: ImageProviderId;
}

// 生成したときのプロフィール(論点 0032)。pool.json の generatedProfile として残し、
// 今のプロフィールと比べて「生成後に変えた」を判定する(core/generatedProfile.ts)。
export type GeneratedProfile = Pick<Character, "name" | "personality" | "voicevoxSpeakerId">;

// 保存できるキャラクターの上限(論点 0032)。新規保存だけを止め、読み込み時には切り詰めない(S0032_28)。
export const MAX_CHARACTER_COUNT = 10;

// 生成の設定(論点 0032)。生成が完了したらそのキャラクターを使用中にするか。
export interface GenerationConfig {
  shouldActivateOnComplete: boolean;
}

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  shouldActivateOnComplete: true,
};

// キャラの窓の表示の設定(設定 JSON では popup.shouldAlwaysShow / popup.shouldShowMessage)。
// shouldAlwaysShow(論点 0036):true ならキャラの窓を常に出し、待機画像を表示する。false なら発動時だけ文言を出す。
// shouldShowMessage(論点 0053):false なら応援のセリフを描かない(音声は鳴らす)。
export interface PopupDisplayConfig {
  shouldAlwaysShow: boolean;
  shouldShowMessage: boolean;
}

export const DEFAULT_POPUP_DISPLAY_CONFIG: PopupDisplayConfig = {
  shouldAlwaysShow: true,
  shouldShowMessage: true,
};

// テーマ(設定 JSON では ui.theme。論点 0057)。メインウィンドウだけに効く。
// system = OS の設定に合わせる。light / dark = OS に従わない
export type ThemeSetting = "system" | "light" | "dark";
export const THEME_SETTINGS = [
  "system",
  "light",
  "dark",
] as const satisfies readonly ThemeSetting[];

export interface UiConfig {
  theme: ThemeSetting;
}

export const DEFAULT_UI_CONFIG: UiConfig = { theme: "system" };

// オンボーディング状態(論点 0018)。
// メインウィンドウの自動表示可否のみを持つ(キャラ作成の進捗そのものは character 側で判定)。
export interface Onboarding {
  skipMainWindowAutoShow: boolean;
}

export const DEFAULT_ONBOARDING: Onboarding = {
  skipMainWindowAutoShow: false,
};

// システム設定(docs/data-model.md「system」)。キャラ作成時の生成先(localhost のランタイム)を決める。
// 応援発動経路はここを参照しない。
export interface SystemConfig {
  ollamaModel: string;
  ollamaEndpoint: string;
  voicevoxEndpoint: string;
  // S0011_09 除外設定 — **スキーマだけを用意し、カウント経路からは参照しない。**
  // 先に契約を置くのは、後から足すと保存済み JSON の移行が要るため(docs/data-model.md「system」)。
  // 参照する実装を入れるときは、先に docs/key-counter.md の該当シナリオを論点から書き換える。
  excludedApps: string[];
  excludedKeys: string[];
}

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  // 論点 0027 で採ったモデル。Ollama 上の名前(公式の重みを取り込んだときに付けた名前)
  ollamaModel: "sarashina2.2-3b-instruct",
  ollamaEndpoint: DEFAULT_OLLAMA_ENDPOINT,
  voicevoxEndpoint: DEFAULT_VOICEVOX_ENDPOINT,
  excludedApps: [],
  excludedKeys: [],
};
