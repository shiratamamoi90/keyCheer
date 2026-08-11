// providers/gate: 生成開始前の前提チェックを「選択全体」へ広げたもの。
// spec: specs/integrations.md「外部選択時は同意ダイアログを経る」
//        「APIキー未設定で外部プロバイダーを選んだ場合 [異常系]」
//        「同意はプロバイダー単位で 1 回のみ」
//
// 単体判定は checkGenerationPreconditions(consent.ts)。ここはそれを
// text → voice の順に当てて、最初に止まったプロバイダーと理由を返すだけ。
// 副作用なし・純粋関数(engine の不変条件)。
// 注意: このモジュールは応援発動経路から import 禁止(eslint.config.js)。

import type { ProviderId, ProviderSelection } from "../../shared/types.js";
import { checkGenerationPreconditions, type ConsentState } from "./consent.js";

export type GenerationGateResult =
  | { ok: true }
  | { ok: false; provider: ProviderId; reason: "missing-api-key" | "consent-required" };

export interface GenerationGateInput {
  selection: ProviderSelection;
  consent: ConsentState;
  /** プロバイダーごとにキーの有無を問う(キーは safeStorage 管轄なので engine は値を見ない)。 */
  hasApiKey: (id: ProviderId) => boolean;
}

export function checkGenerationGate(input: GenerationGateInput): GenerationGateResult {
  const { selection, consent, hasApiKey } = input;

  // 生成はテキスト → 音声の順に走る。止まる順もそれに合わせる
  // (renderer が最初に出すダイアログが、実際に最初に必要になるものと一致する)。
  // 画像は生成フローに乗っていないため見ない — ここで止めると文言・音声まで巻き添えになる。
  for (const provider of [selection.text, selection.voice] as const) {
    const precondition = checkGenerationPreconditions({
      provider,
      hasApiKey: hasApiKey(provider),
      consent,
    });
    if (!precondition.ok) return { ok: false, provider, reason: precondition.reason };
  }

  return { ok: true };
}
