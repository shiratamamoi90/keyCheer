// providers/registry: プロバイダー識別子のバリデーション(閉じた union)。純粋関数のみ。
// spec: 論点 0016「プロバイダー一覧の契約 [境界]」/ docs/integrations.md
// 注意: このモジュールは応援発動経路(trigger / cheerSelector 等)から import 禁止(eslint.config.js)。

import {
  TEXT_PROVIDER_IDS,
  VOICE_PROVIDER_IDS,
  IMAGE_PROVIDER_IDS,
  type TextProviderId,
  type VoiceProviderId,
  type ImageProviderId,
  type ProviderId,
  type ProviderSelection,
} from "../shared/types.js";

const TEXT_SET = new Set<string>(TEXT_PROVIDER_IDS);
const VOICE_SET = new Set<string>(VOICE_PROVIDER_IDS);
const IMAGE_SET = new Set<string>(IMAGE_PROVIDER_IDS);

// シナリオ: プロバイダー一覧の契約 [境界]
export function isTextProviderId(value: unknown): value is TextProviderId {
  return typeof value === "string" && TEXT_SET.has(value);
}

export function isVoiceProviderId(value: unknown): value is VoiceProviderId {
  return typeof value === "string" && VOICE_SET.has(value);
}

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return typeof value === "string" && IMAGE_SET.has(value);
}

// ローカル(localhost 通信のみ・同意不要)/ 外部(明示同意必須)の区別
const LOCAL_PROVIDER_IDS = new Set<string>(["local-ollama", "local-voicevox", "local-sdcpp"]);

export function isLocalProvider(id: ProviderId | string): boolean {
  return LOCAL_PROVIDER_IDS.has(id);
}

export type ProviderSelectionResult =
  | { ok: true; value: ProviderSelection }
  | { ok: false; errors: string[] };

// シナリオ: プロバイダー設定の保存(値の受理条件)/ プロバイダー一覧の契約 [境界]
export function validateProviderSelection(input: unknown): ProviderSelectionResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["ProviderSelection は object である必要がある"] };
  }
  const obj = input as Record<string, unknown>;
  const errors: string[] = [];
  if (!isTextProviderId(obj["text"])) {
    errors.push(`text プロバイダーが不正(received: ${String(obj["text"])})`);
  }
  if (!isVoiceProviderId(obj["voice"])) {
    errors.push(`voice プロバイダーが不正(received: ${String(obj["voice"])})`);
  }
  if (!isImageProviderId(obj["image"])) {
    errors.push(`image プロバイダーが不正(received: ${String(obj["image"])})`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      text: obj["text"] as TextProviderId,
      voice: obj["voice"] as VoiceProviderId,
      image: obj["image"] as ImageProviderId,
    },
  };
}
