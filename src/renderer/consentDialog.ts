// consentDialog: 外部プロバイダー同意ダイアログのビューモデル(純粋関数)。
// spec: specs/integrations.md「同意ダイアログに ToS リンクと必須チェック」
//                            「外部選択時は同意ダイアログを経る」
//
// DOM 生成・リンクを開く・同意の確定(永続化)は mainEntry / main 側の I/O グルー。
// ここは「何を出すか」「いつ送信ボタンを押せるか」だけを持つ。
// engine 実装 / providers は import しない(renderer は使う側。eslint.config.js)。

import type { ProviderId } from "../shared/types.js";
import { disclosureFor } from "../shared/providerDisclosure.js";

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
