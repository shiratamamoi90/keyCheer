import { describe, it, expect } from "vitest";
import {
  createAuditLogger,
  summarizeTextPayload,
  type AuditEntry,
} from "../../src/agent/auditLog.js";

// spec: specs/integrations.md「外部送信を監査ログに記録」/ specs/data-model.md「監査ログ」
//   {timestamp, provider, action, payloadSummary} を append。payload 本文は含めない・要約のみ。
//   clock と appender は注入。

describe("auditLog / 外部送信を監査ログに記録", () => {
  it("appends an entry with injected timestamp, provider, action, and summary", () => {
    const entries: AuditEntry[] = [];
    const logger = createAuditLogger({
      append: (e) => entries.push(e),
      now: () => new Date("2026-07-09T12:00:00.000Z"),
    });

    logger.recordExternalSend({
      provider: "openai",
      action: "text-generation",
      payloadSummary: "scenario=fast_regular_evening, personality=12 chars",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      timestamp: "2026-07-09T12:00:00.000Z",
      provider: "openai",
      action: "text-generation",
      payloadSummary: "scenario=fast_regular_evening, personality=12 chars",
    });
  });

  it("records each external send as a separate append (audit trail)", () => {
    const entries: AuditEntry[] = [];
    const logger = createAuditLogger({ append: (e) => entries.push(e), now: () => new Date(0) });
    logger.recordExternalSend({
      provider: "openai",
      action: "text-generation",
      payloadSummary: "a",
    });
    logger.recordExternalSend({
      provider: "openai-tts",
      action: "voice-synthesis",
      payloadSummary: "b",
    });
    expect(entries.map((e) => e.provider)).toEqual(["openai", "openai-tts"]);
  });
});

describe("auditLog / payload 本文を含めない(要約のみ)", () => {
  it("summarizeTextPayload does not leak the personality text or generated content", () => {
    const personality = "元気いっぱいで語尾に「だよ!」をつける秘密の設定";
    const summary = summarizeTextPayload({
      scenarioKey: "fast_regular_evening",
      personality,
    });
    // シナリオキー(内容ではないメタ情報)は含んでよい
    expect(summary).toContain("fast_regular_evening");
    // 性格説明の本文は含めない(文字数などの要約のみ)
    expect(summary).not.toContain(personality);
    expect(summary).not.toContain("秘密の設定");
    // 文字数のような要約は許容
    expect(summary).toMatch(/\d+/);
  });
});
