// providerRouter: キャラ作成時のテキスト生成を、設定に応じたプロバイダーへ振り分ける。
// spec: changes/0003-external-api-providers/spec.md / specs/integrations.md
// 責務:
//   1. 前提条件(同意 + API キー)を engine の checkGenerationPreconditions で確認(ローカルは免除)
//   2. 外部送信の直前に監査ログへ記録(本文を含まない要約のみ)
//   3. 失敗しても別プロバイダーへ自動フォールバックしない(C6)
// 発動経路とは無関係(このモジュールはキャラ作成フローからのみ呼ばれる)。

import type { TextGenerator, TextGenerationRequest } from "../engine/providers/types.js";
import type { TextProviderId } from "../shared/types.js";
import { isLocalProvider } from "../engine/providers/registry.js";
import { checkGenerationPreconditions, type ConsentState } from "../engine/providers/consent.js";
import type { AuditLogger } from "./auditLog.js";

export type RouteTextResult =
  | { ok: true; messages: string[] }
  | {
      ok: false;
      reason: "missing-api-key" | "consent-required" | "provider-unavailable" | "generation-failed";
      error?: unknown;
    };

export interface RouteTextInput {
  providerId: TextProviderId;
  providers: Partial<Record<TextProviderId, TextGenerator>>;
  request: TextGenerationRequest;
  consent: ConsentState;
  hasApiKey: boolean;
  audit: AuditLogger;
  auditSummary: string; // 本文を含まない要約(summarizeTextPayload で生成)
}

export async function routeTextGeneration(input: RouteTextInput): Promise<RouteTextResult> {
  const { providerId, providers, request, consent, hasApiKey, audit, auditSummary } = input;

  // 1. 前提条件ゲート(送信前に判定。ブロック時は送信も監査もしない)
  const pre = checkGenerationPreconditions({ provider: providerId, hasApiKey, consent });
  if (!pre.ok) return { ok: false, reason: pre.reason };

  const provider = providers[providerId];
  if (!provider) return { ok: false, reason: "provider-unavailable" };

  // 2. 外部送信は監査記録(ローカルは localhost 通信のため記録しない)
  if (!isLocalProvider(providerId)) {
    audit.recordExternalSend({
      provider: providerId,
      action: "text-generation",
      payloadSummary: auditSummary,
    });
  }

  // 3. 呼び出し。失敗しても他プロバイダーへは切り替えない(自動フォールバック禁止)
  try {
    const messages = await provider.generateMessages(request);
    return { ok: true, messages };
  } catch (error) {
    return { ok: false, reason: "generation-failed", error };
  }
}
