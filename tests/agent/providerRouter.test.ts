import { describe, it, expect, vi } from "vitest";
import { routeTextGeneration } from "../../src/agent/providerRouter.js";
import { emptyConsentState, grantConsent } from "../../src/core/providers/consent.js";
import { createAuditLogger } from "../../src/agent/auditLog.js";
import type { TextGenerator } from "../../src/core/providers/types.js";
import type { TextProviderId } from "../../src/core/shared/types.js";

// spec: 論点 0016 / docs/integrations.md
//   ローカル/外部ルーティング、前提条件(同意 + API キー)ゲート、外部送信を監査記録、
//   失敗時は自動でローカルにフォールバックしない(C6)。

const request = {
  systemPrompt: "p",
  scenarioKey: "fast_regular_evening",
  count: 20,
  timeoutMs: 10_000,
};

function fakeGenerator(id: TextProviderId, impl: () => Promise<string[]>): TextGenerator {
  return { id, generateMessages: vi.fn(impl) };
}

function noopAudit() {
  const entries: unknown[] = [];
  return {
    logger: createAuditLogger({ append: (e) => entries.push(e), now: () => new Date(0) }),
    entries,
  };
}

describe("providerRouter / ローカル選択時は同意・キー不要で送信、監査記録なし", () => {
  it("routes to a local provider without consent/apiKey and does not audit", async () => {
    const local = fakeGenerator("local-ollama", async () => ["ok"]);
    const { logger, entries } = noopAudit();
    const result = await routeTextGeneration({
      providerId: "local-ollama",
      providers: { "local-ollama": local },
      request,
      consent: emptyConsentState(),
      hasApiKey: false,
      audit: logger,
      auditSummary: "should-not-be-used",
    });
    expect(result).toEqual({ ok: true, messages: ["ok"] });
    expect(entries).toHaveLength(0); // ローカルは外部送信ではない
  });
});

describe("providerRouter / 前提条件ゲート", () => {
  it("blocks external provider without consent (provider not called, no audit)", async () => {
    const openai = fakeGenerator("openai", async () => ["nope"]);
    const { logger, entries } = noopAudit();
    const result = await routeTextGeneration({
      providerId: "openai",
      providers: { openai },
      request,
      consent: emptyConsentState(), // 未同意
      hasApiKey: true,
      audit: logger,
      auditSummary: "s",
    });
    expect(result).toEqual({ ok: false, reason: "consent-required" });
    expect(openai.generateMessages).not.toHaveBeenCalled();
    expect(entries).toHaveLength(0); // 送信していないので監査記録もしない
  });

  it("blocks external provider without api key", async () => {
    const openai = fakeGenerator("openai", async () => ["nope"]);
    const { logger } = noopAudit();
    const result = await routeTextGeneration({
      providerId: "openai",
      providers: { openai },
      request,
      consent: grantConsent(emptyConsentState(), "openai"),
      hasApiKey: false,
      audit: logger,
      auditSummary: "s",
    });
    expect(result).toEqual({ ok: false, reason: "missing-api-key" });
    expect(openai.generateMessages).not.toHaveBeenCalled();
  });
});

describe("providerRouter / 外部送信は監査ログに記録", () => {
  it("records an audit entry before sending, then returns messages", async () => {
    const openai = fakeGenerator("openai", async () => ["がんばれ"]);
    const { logger, entries } = noopAudit();
    const result = await routeTextGeneration({
      providerId: "openai",
      providers: { openai },
      request,
      consent: grantConsent(emptyConsentState(), "openai"),
      hasApiKey: true,
      audit: logger,
      auditSummary: "scenario=fast_regular_evening, personality=8 chars",
    });
    expect(result).toEqual({ ok: true, messages: ["がんばれ"] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      provider: "openai",
      action: "text-generation",
      payloadSummary: "scenario=fast_regular_evening, personality=8 chars",
    });
  });
});

describe("providerRouter / 外部生成失敗時は自動でローカルに切り替えない [異常系]", () => {
  it("S0016_06 returns generation-failed and never calls the local provider", async () => {
    const openai = fakeGenerator("openai", async () => {
      throw new Error("500 upstream");
    });
    const local = fakeGenerator("local-ollama", async () => ["local-fallback-should-not-happen"]);
    const { logger, entries } = noopAudit();

    const result = await routeTextGeneration({
      providerId: "openai",
      providers: { openai, "local-ollama": local },
      request,
      consent: grantConsent(emptyConsentState(), "openai"),
      hasApiKey: true,
      audit: logger,
      auditSummary: "s",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("generation-failed");
    expect(openai.generateMessages).toHaveBeenCalledTimes(1);
    expect(local.generateMessages).not.toHaveBeenCalled(); // 自動フォールバック禁止
    expect(entries).toHaveLength(1); // 送信は試みたので監査には残る
  });
});

describe("providerRouter / プロバイダー未登録 [境界]", () => {
  it("returns provider-unavailable when the selected id has no implementation", async () => {
    const { logger } = noopAudit();
    const result = await routeTextGeneration({
      providerId: "anthropic", // MVP 未実装
      providers: {},
      request,
      consent: grantConsent(emptyConsentState(), "anthropic"),
      hasApiKey: true,
      audit: logger,
      auditSummary: "s",
    });
    expect(result).toEqual({ ok: false, reason: "provider-unavailable" });
  });
});

// spec: 論点 0016
// 回帰ガード:providerRouter はプロバイダーごとの分岐を持たない汎用実装であり、
// 新しい外部プロバイダーを足しても router 側の変更を要さないことを固定する。
// (実装より後に書いたテスト。Red は経ていない — router は最初からこの性質を満たしていた)
describe("providerRouter / 新しい外部プロバイダーは router を変えずに通る", () => {
  it("routes anthropic through the same generic path as openai", async () => {
    const gen = fakeGenerator("anthropic", async () => ["がんばれ!"]);
    const { logger, entries } = noopAudit();

    const result = await routeTextGeneration({
      providerId: "anthropic",
      providers: { anthropic: gen },
      request,
      consent: grantConsent(emptyConsentState(), "anthropic"),
      hasApiKey: true,
      audit: logger,
      auditSummary: "20 messages",
    });

    expect(result).toEqual({ ok: true, messages: ["がんばれ!"] });
    // 外部プロバイダーなので監査ログに残る
    expect(entries).toHaveLength(1);
  });
});
