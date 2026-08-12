// 外部プロバイダーの開示情報(同意ダイアログに出す静的データ)。
// 要件: docs/integrations.md「同意ダイアログに ToS リンクと必須チェック」
//
// なぜ types.ts と分けるか: 発動経路(main/index.ts・cheerRuntime.ts・core/runtime.ts)は
// src/core/shared/types.ts を import する。プロバイダーの開示情報をそこへ混ぜると、
// 発動経路が providers 由来のデータを抱えることになる。別モジュールに切って
// 「キャラ作成側だけが読む」状態を保つ(CLAUDE.md の発動経路分離)。
//
// [要確認] 各 URL は公式ドキュメント準拠の想定値。実疎通・目視確認で裏を取るまで確定としない
// (論点 0016 の tasks.md 参照)。リンク切れは同意の前提を壊すので必ず人間が確認する。

import type { ProviderId } from "./types.js";

export interface ProviderDisclosure {
  /** ダイアログ見出しに出す表示名 */
  readonly displayName: string;
  readonly tosUrl: string;
  readonly privacyUrl: string;
  /** 「送信される情報」として列挙する項目 */
  readonly sentItems: readonly string[];
}

// キャラ作成時に送るもの。発動時のキーカウント・KPM・統計は一切含まない(プライバシー方針)。
const TEXT_SENT_ITEMS = ["キャラクターの性格説明", "応援メッセージ生成用のプロンプト"] as const;
const VOICE_SENT_ITEMS = ["生成済みの応援メッセージ本文", "音声合成の指定(話者・書式)"] as const;
const IMAGE_SENT_ITEMS = ["キャラクターの性格説明", "画像生成用のプロンプト"] as const;

const OPENAI_TOS = "https://openai.com/policies/terms-of-use";
const OPENAI_PRIVACY = "https://openai.com/policies/privacy-policy";

const DISCLOSURES: Readonly<Partial<Record<ProviderId, ProviderDisclosure>>> = {
  openai: {
    displayName: "OpenAI",
    tosUrl: OPENAI_TOS,
    privacyUrl: OPENAI_PRIVACY,
    sentItems: TEXT_SENT_ITEMS,
  },
  "openai-tts": {
    displayName: "OpenAI TTS",
    tosUrl: OPENAI_TOS,
    privacyUrl: OPENAI_PRIVACY,
    sentItems: VOICE_SENT_ITEMS,
  },
  "openai-dalle": {
    displayName: "OpenAI DALL·E",
    tosUrl: OPENAI_TOS,
    privacyUrl: OPENAI_PRIVACY,
    sentItems: IMAGE_SENT_ITEMS,
  },
  anthropic: {
    displayName: "Anthropic",
    tosUrl: "https://www.anthropic.com/legal/consumer-terms",
    privacyUrl: "https://www.anthropic.com/legal/privacy",
    sentItems: TEXT_SENT_ITEMS,
  },
  elevenlabs: {
    displayName: "ElevenLabs",
    tosUrl: "https://elevenlabs.io/terms-of-use",
    privacyUrl: "https://elevenlabs.io/privacy-policy",
    sentItems: VOICE_SENT_ITEMS,
  },
  "stability-ai": {
    displayName: "Stability AI",
    tosUrl: "https://stability.ai/terms-of-use",
    privacyUrl: "https://stability.ai/privacy-policy",
    sentItems: IMAGE_SENT_ITEMS,
  },
};

/** ローカルプロバイダーには開示情報が無い(同意対象外)。 */
export function disclosureFor(id: ProviderId): ProviderDisclosure | null {
  return DISCLOSURES[id] ?? null;
}

// 画面に出す名前。開示情報を持たないローカル分もここには載る
// (ドロップダウンはローカル・外部を同じ並びで出すため)。
const LOCAL_DISPLAY_NAMES: Readonly<Partial<Record<ProviderId, string>>> = {
  "local-ollama": "Ollama(ローカル)",
  "local-voicevox": "VOICEVOX(ローカル)",
  "local-sdcpp": "stable-diffusion.cpp(ローカル)",
};

export function providerDisplayName(id: ProviderId): string {
  return DISCLOSURES[id]?.displayName ?? LOCAL_DISPLAY_NAMES[id] ?? id;
}

// 信頼境界:renderer から届いた値を同意として書く前の門(security-rules.md「入力と信頼境界」)。
// 「開示情報を持つ = 外部プロバイダー = 同意の対象」。ローカル・未知の文字列・非文字列はすべて弾く。
// hasOwnProperty で見るのは、`__proto__` や `toString` が prototype 経由で真になるのを防ぐため。
export function isConsentableProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DISCLOSURES, value);
}
