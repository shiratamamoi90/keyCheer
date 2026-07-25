// auditLog: 外部プロバイダーへの送信を監査ログに記録する。キャラ作成時のみ発生。
// spec: specs/integrations.md「外部送信を監査ログに記録」/ specs/data-model.md「監査ログ」
// 不変条件: payload 本文は含めない(要約のみ)。stats とは別ファイル({userData}/audit.log.json)。
// clock と appender(実際の追記 I/O)は注入する。

import type { ProviderId } from "../shared/types.js";

export interface AuditEntry {
  timestamp: string; // ISO 8601
  provider: ProviderId;
  action: string; // 例: "text-generation" | "voice-synthesis" | "image-generation"
  payloadSummary: string; // 本文を含まない要約
}

export interface AuditLogger {
  recordExternalSend(input: { provider: ProviderId; action: string; payloadSummary: string }): void;
}

export function createAuditLogger(deps: {
  append: (entry: AuditEntry) => void;
  now: () => Date;
}): AuditLogger {
  const { append, now } = deps;
  return {
    recordExternalSend({ provider, action, payloadSummary }) {
      append({ timestamp: now().toISOString(), provider, action, payloadSummary });
    },
  };
}

// テキスト生成の payload 要約(本文を含めない — 性格説明やプロンプト本文は文字数のみ)
export function summarizeTextPayload(input: { scenarioKey: string; personality: string }): string {
  return `scenario=${input.scenarioKey}, personality=${[...input.personality].length} chars`;
}
