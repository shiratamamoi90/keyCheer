// renderer/consentDialog: 外部プロバイダー同意ダイアログのビューモデル(純粋関数)。
// spec: specs/integrations.md「同意ダイアログに ToS リンクと必須チェック」
//        specs/integrations.md「外部選択時は同意ダイアログを経る」
//
// DOM 操作・IPC は mainEntry 側の I/O グルー。ここは「何を出すか」「いつ送信できるか」だけを縛る。
// 送信そのものは行わない(同意が成立するまで送信経路に入らないことは main 側で担保する)。

import { describe, it, expect } from "vitest";
import {
  openConsentDialog,
  setAgreement,
  canSubmitConsent,
  consentNeededFor,
  blockMessage,
  type ConsentDialogState,
} from "../../src/renderer/consentDialog.js";
import { isConsentableProviderId } from "../../src/shared/providerDisclosure.js";

describe("consentDialog / 同意ダイアログに ToS リンクと必須チェック", () => {
  it("includes the tos and privacy links of that provider", () => {
    const state = openConsentDialog("openai");
    expect(state.tosUrl).toMatch(/^https:\/\//);
    expect(state.privacyUrl).toMatch(/^https:\/\//);
  });

  it("shows what will be sent to the provider", () => {
    const state = openConsentDialog("openai");
    // 「送信される情報(性格説明・プロンプト等)を明示する」
    expect(state.sentItems.length).toBeGreaterThan(0);
    expect(state.sentItems.join()).toContain("性格");
  });

  it("disables submit while the agreement box is unchecked", () => {
    const state = openConsentDialog("openai");
    expect(state.agreed).toBe(false);
    expect(canSubmitConsent(state)).toBe(false);
  });

  it("enables submit once the agreement box is checked", () => {
    const state = setAgreement(openConsentDialog("openai"), true);
    expect(state.agreed).toBe(true);
    expect(canSubmitConsent(state)).toBe(true);
  });

  it("disables submit again when the box is unchecked back", () => {
    const checked = setAgreement(openConsentDialog("openai"), true);
    const unchecked = setAgreement(checked, false);
    expect(canSubmitConsent(unchecked)).toBe(false);
  });

  it("carries the provider it was opened for", () => {
    const state = openConsentDialog("elevenlabs");
    expect(state.providerId).toBe("elevenlabs");
  });

  it("never mutates the given state", () => {
    const state = openConsentDialog("anthropic");
    const next: ConsentDialogState = setAgreement(state, true);
    expect(state.agreed).toBe(false);
    expect(next).not.toBe(state);
  });
});

describe("consentDialog / 外部選択時は同意ダイアログを経る", () => {
  it("has disclosure for every external provider", () => {
    // ローカル以外はすべてダイアログを出せなければならない(出せない = 同意なしで送信しうる)。
    for (const id of [
      "openai",
      "anthropic",
      "openai-tts",
      "elevenlabs",
      "openai-dalle",
      "stability-ai",
    ] as const) {
      const state = openConsentDialog(id);
      expect(state.tosUrl, id).toMatch(/^https:\/\//);
      expect(state.privacyUrl, id).toMatch(/^https:\/\//);
      expect(state.sentItems.length, id).toBeGreaterThan(0);
    }
  });

  it("refuses to open for a local provider", () => {
    // ローカルは同意対象外。ダイアログを開けてしまうと同意の意味が壊れる。
    expect(() => openConsentDialog("local-ollama" as never)).toThrow();
  });
});

describe("providerDisclosure / 同意はプロバイダー単位で 1 回のみ", () => {
  it("accepts only the external provider ids as consentable", () => {
    for (const id of [
      "openai",
      "anthropic",
      "openai-tts",
      "elevenlabs",
      "openai-dalle",
      "stability-ai",
    ]) {
      expect(isConsentableProviderId(id), id).toBe(true);
    }
  });

  it("rejects local providers, unknown strings and non-strings [信頼境界]", () => {
    // renderer から来る値をそのまま同意として書かないための門。
    for (const bad of [
      "local-ollama",
      "local-voicevox",
      "local-sdcpp",
      "",
      "OPENAI",
      "openai ",
      "__proto__",
      "toString",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isConsentableProviderId(bad), String(bad)).toBe(false);
    }
  });
});

describe("consentDialog / 外部生成失敗時は自動でローカルに切り替えない [異常系]", () => {
  it("asks for consent only when that is what blocked generation", () => {
    expect(consentNeededFor({ ok: false, reason: "consent-required", provider: "openai" })).toBe(
      "openai",
    );
  });

  it("does not ask for consent when the api key is what is missing", () => {
    // キー未設定でダイアログを出すと、同意しても直らない画面を見せることになる。
    expect(
      consentNeededFor({ ok: false, reason: "missing-api-key", provider: "openai" }),
    ).toBeNull();
  });

  it("returns null for the failures that have nothing to do with providers", () => {
    expect(consentNeededFor({ ok: false, reason: "already-running" })).toBeNull();
    expect(consentNeededFor({ ok: false, reason: "no-character" })).toBeNull();
    expect(consentNeededFor({ ok: true })).toBeNull();
  });

  it("explains each provider-related failure without offering an automatic switch", () => {
    // 確定事項: 自動では切り替えない。文言も「切り替えました」にしない。
    const consent = blockMessage("consent-required", "OpenAI");
    const key = blockMessage("missing-api-key", "OpenAI");
    const voice = blockMessage("voice-id-required", "ElevenLabs");
    for (const text of [consent, key, voice]) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/切り替えました|自動/);
    }
    expect(key).toContain("API キー");
    expect(voice).toContain("voice");
    expect(consent).toContain("同意");
  });

  it("names the provider it is talking about", () => {
    expect(blockMessage("missing-api-key", "Anthropic")).toContain("Anthropic");
  });
});
