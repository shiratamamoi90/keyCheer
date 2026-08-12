// providers/consent: 外部プロバイダー同意の状態遷移(プロバイダー単位・純粋関数のみ)。
// spec: 論点 0016(外部選択時は同意ダイアログを経る /
//        同意済みへの再送信 / 切り替えで同意リセット / キー漏出防止 / APIキー未設定)
// ダイアログ表示・永続化(未通過は永続化しない)は main/UI 側の責務。
// core は「明示的な grantConsent のみが同意を作る」ことを保証する。
// 注意: このモジュールは応援発動経路から import 禁止(eslint.config.js)。

import type { ProviderId } from "../shared/types.js";
import { isLocalProvider } from "./registry.js";

// キー = ProviderId、値 = 同意済みフラグ。true は grantConsent 経由でのみ生まれる。
export type ConsentState = Readonly<Partial<Record<ProviderId, boolean>>>;

export function emptyConsentState(): ConsentState {
  return {};
}

// シナリオ: 外部選択時は同意ダイアログを経る / プロバイダー切り替えで同意リセット
export function needsConsentDialog(id: ProviderId, state: ConsentState): boolean {
  if (isLocalProvider(id)) return false;
  return state[id] !== true;
}

// シナリオ: 同意済みプロバイダーへの再送信
export function grantConsent(state: ConsentState, id: ProviderId): ConsentState {
  return { ...state, [id]: true };
}

// シナリオ: 同意ダイアログ未通過でのキー漏出防止(暗黙の true は存在しない)
export function canSendTo(id: ProviderId, state: ConsentState): boolean {
  if (isLocalProvider(id)) return true;
  return state[id] === true;
}

export type GenerationPrecondition =
  | { ok: true }
  | { ok: false; reason: "missing-api-key" | "consent-required" };

// シナリオ: APIキー未設定で外部プロバイダーを選んだ場合 [異常系]
// ブロック理由の優先順は「キー未設定 → 同意未通過」(キーが無ければそもそも送信できないため先に案内する)。
export function checkGenerationPreconditions(input: {
  provider: ProviderId;
  hasApiKey: boolean;
  consent: ConsentState;
}): GenerationPrecondition {
  const { provider, hasApiKey, consent } = input;
  if (isLocalProvider(provider)) return { ok: true };
  if (!hasApiKey) return { ok: false, reason: "missing-api-key" };
  if (!canSendTo(provider, consent)) return { ok: false, reason: "consent-required" };
  return { ok: true };
}
