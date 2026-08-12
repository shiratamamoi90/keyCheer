// consentDialog: 外部プロバイダー同意ダイアログのビューモデル(純粋関数)。
// 要件: docs/integrations.md「同意ダイアログに ToS リンクと必須チェック」
//                            「外部選択時は同意ダイアログを経る」
//
// DOM 生成・リンクを開く・同意の確定(永続化)は mainEntry / main 側の I/O グルー。
// ここは「何を出すか」「いつ送信ボタンを押せるか」だけを持つ。
// core 実装 / providers は import しない(renderer は使う側。eslint.config.js)。

import type { ProviderId } from "../core/shared/types.js";
import { disclosureFor } from "../core/shared/providerDisclosure.js";

export interface ConsentDialogState {
  readonly providerId: ProviderId;
  readonly displayName: string;
  readonly tosUrl: string;
  readonly privacyUrl: string;
  readonly sentItems: readonly string[];
  /** 「同意します」必須チェックの状態。既定は未チェック。 */
  readonly agreed: boolean;
}

// シナリオ: 外部選択時は同意ダイアログを経る
// ローカルには開示情報が無い。開けてしまうと「同意なしで送信しうる」経路を作るので投げる。
export function openConsentDialog(providerId: ProviderId): ConsentDialogState {
  const disclosure = disclosureFor(providerId);
  if (disclosure === null) {
    throw new Error(`consent dialog is not applicable to a local provider: ${providerId}`);
  }
  return {
    providerId,
    displayName: disclosure.displayName,
    tosUrl: disclosure.tosUrl,
    privacyUrl: disclosure.privacyUrl,
    sentItems: disclosure.sentItems,
    agreed: false,
  };
}

// シナリオ: 同意ダイアログに ToS リンクと必須チェック
export function setAgreement(state: ConsentDialogState, agreed: boolean): ConsentDialogState {
  return { ...state, agreed };
}

// シナリオ: 同意ダイアログに ToS リンクと必須チェック(チェックなしでは「送信」ボタンは無効)
export function canSubmitConsent(state: ConsentDialogState): boolean {
  return state.agreed;
}

// 生成開始が返しうる失敗のうち、providers に関わるものだけを扱う形。
// main の StartGenerationResult と同じ形を renderer 側で受けるための最小の型。
export type GenerationFailure =
  | { ok: true }
  | { ok: false; reason: "already-running" | "no-character" }
  | {
      ok: false;
      reason: "consent-required" | "missing-api-key" | "voice-id-required";
      provider: ProviderId;
    };

// シナリオ: 外部選択時は同意ダイアログを経る
// 同意で解ける失敗だけがダイアログの対象。キー未設定でダイアログを出すと、
// 同意しても直らない画面を見せることになる。
export function consentNeededFor(result: GenerationFailure): ProviderId | null {
  if (result.ok) return null;
  return result.reason === "consent-required" ? result.provider : null;
}

// シナリオ: 外部生成失敗時は自動でローカルに切り替えない [異常系]
// 確定事項(2026-07-26): 自動では切り替えず、ユーザーに提示して手動で切り替える。
// よって文言も「切り替えました」と書かない — 何が足りないかだけを伝える。
export function blockMessage(
  reason: "consent-required" | "missing-api-key" | "voice-id-required",
  displayName: string,
): string {
  switch (reason) {
    case "consent-required":
      return `${displayName} への送信にはあなたの同意が必要です。`;
    case "missing-api-key":
      return `${displayName} の API キーが設定されていません。`;
    case "voice-id-required":
      return `${displayName} の voice ID が設定されていません。`;
  }
}
