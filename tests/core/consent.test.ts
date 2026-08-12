import { describe, it, expect } from "vitest";
import {
  emptyConsentState,
  needsConsentDialog,
  grantConsent,
  canSendTo,
  checkGenerationPreconditions,
} from "../../src/core/providers/consent.js";

// spec: 論点 0016 / docs/integrations.md
// 同意はプロバイダー単位で 1 回。ローカルは同意不要。core は状態遷移の純粋関数のみ
//(ダイアログ表示・永続化は main/UI 側)。

describe("consent / 外部選択時は同意ダイアログを経る", () => {
  it("S0016_02 requires a consent dialog for an external provider without consent", () => {
    const state = emptyConsentState();
    expect(needsConsentDialog("openai", state)).toBe(true);
    expect(canSendTo("openai", state)).toBe(false);
  });

  it("does not require consent for local providers", () => {
    const state = emptyConsentState();
    for (const id of ["local-ollama", "local-voicevox", "local-sdcpp"] as const) {
      expect(needsConsentDialog(id, state), id).toBe(false);
      expect(canSendTo(id, state), id).toBe(true);
    }
  });
});

describe("consent / 同意済みプロバイダーへの再送信(同意はプロバイダー単位で 1 回のみ)", () => {
  it("S0016_03 after granting, no dialog is needed and sending is allowed", () => {
    const granted = grantConsent(emptyConsentState(), "openai");
    expect(needsConsentDialog("openai", granted)).toBe(false);
    expect(canSendTo("openai", granted)).toBe(true);
  });

  it("grantConsent is pure (does not mutate the previous state)", () => {
    const before = emptyConsentState();
    grantConsent(before, "openai");
    expect(canSendTo("openai", before)).toBe(false);
  });
});

describe("consent / プロバイダー切り替えで同意リセット", () => {
  it("consent is per provider: switching to anthropic re-requires a dialog", () => {
    // GIVEN openai に同意済み、anthropic には未同意
    const state = grantConsent(emptyConsentState(), "openai");
    // WHEN anthropic に切り替えて初回生成
    // THEN anthropic はダイアログ必要、openai は不要のまま
    expect(needsConsentDialog("anthropic", state)).toBe(true);
    expect(needsConsentDialog("openai", state)).toBe(false);
  });
});

describe("consent / 同意ダイアログ未通過でのキー漏出防止 [境界]", () => {
  it("consent exists only via explicit grantConsent (no implicit true)", () => {
    // GIVEN ダイアログ表示中に強制終了 → 再起動(= grant されていない state)
    const state = emptyConsentState();
    // THEN 送信不可のまま(暗黙の true は存在しない)
    expect(canSendTo("openai", state)).toBe(false);
    expect(needsConsentDialog("openai", state)).toBe(true);
  });
});

describe("consent / APIキー未設定で外部プロバイダーを選んだ場合 [異常系]", () => {
  it("blocks generation with reason missing-api-key (before any sending)", () => {
    const result = checkGenerationPreconditions({
      provider: "openai",
      hasApiKey: false,
      consent: grantConsent(emptyConsentState(), "openai"),
    });
    expect(result).toEqual({ ok: false, reason: "missing-api-key" });
  });

  it("blocks generation with reason consent-required when key exists but no consent", () => {
    const result = checkGenerationPreconditions({
      provider: "openai",
      hasApiKey: true,
      consent: emptyConsentState(),
    });
    expect(result).toEqual({ ok: false, reason: "consent-required" });
  });

  it("allows generation for external provider with key and consent", () => {
    const result = checkGenerationPreconditions({
      provider: "openai",
      hasApiKey: true,
      consent: grantConsent(emptyConsentState(), "openai"),
    });
    expect(result).toEqual({ ok: true });
  });

  it("allows local providers regardless of api key and consent", () => {
    const result = checkGenerationPreconditions({
      provider: "local-ollama",
      hasApiKey: false,
      consent: emptyConsentState(),
    });
    expect(result).toEqual({ ok: true });
  });
});
