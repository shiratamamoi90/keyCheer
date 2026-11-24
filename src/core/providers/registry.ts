// providers/registry: プロバイダー識別子のバリデーション(閉じた union)。純粋関数のみ。
// spec: docs/integrations.md「プロバイダー識別子」/ docs/data-model.md S0022_10(生成元の記録の定義域)
// 注意: このモジュールは応援発動経路(trigger / cheerSelector 等)から import 禁止(eslint.config.js)。

import {
  TEXT_PROVIDER_IDS,
  VOICE_PROVIDER_IDS,
  IMAGE_PROVIDER_IDS,
  type TextProviderId,
  type VoiceProviderId,
  type ImageProviderId,
} from "../shared/types.js";

const TEXT_SET = new Set<string>(TEXT_PROVIDER_IDS);
const VOICE_SET = new Set<string>(VOICE_PROVIDER_IDS);
const IMAGE_SET = new Set<string>(IMAGE_PROVIDER_IDS);

export function isTextProviderId(value: unknown): value is TextProviderId {
  return typeof value === "string" && TEXT_SET.has(value);
}

export function isVoiceProviderId(value: unknown): value is VoiceProviderId {
  return typeof value === "string" && VOICE_SET.has(value);
}

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return typeof value === "string" && IMAGE_SET.has(value);
}
