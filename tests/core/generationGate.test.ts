// core/providers/gate: 生成開始前の前提チェック(テキスト・音声をまとめて見る)。
// 要件: docs/integrations.md「外部選択時は同意ダイアログを経る」
//        「APIキー未設定で外部プロバイダーを選んだ場合 [異常系]」
//
// 単体の checkGenerationPreconditions を選択全体へ広げたもの。どのプロバイダーが
// 何で止まったかを返す — renderer はそれを見てどの同意ダイアログを出すか決める。

import { describe, it, expect } from "vitest";
import { checkGenerationGate } from "../../src/core/providers/gate.js";
import type { ProviderSelection } from "../../src/core/shared/types.js";

const LOCAL: ProviderSelection = {
  text: "local-ollama",
  voice: "local-voicevox",
  image: "local-sdcpp",
};

const noKeys = (): boolean => false;
const allKeys = (): boolean => true;

describe("generationGate / 外部選択時は同意ダイアログを経る", () => {
  it("passes when every selected provider is local", () => {
    // ローカルのみなら同意もキーも要らない。
    expect(checkGenerationGate({ selection: LOCAL, consent: {}, hasApiKey: noKeys })).toEqual({
      ok: true,
    });
  });

  it("blocks on consent when an external text provider was never consented to", () => {
    const result = checkGenerationGate({
      selection: { ...LOCAL, text: "openai" },
      consent: {},
      hasApiKey: allKeys,
    });
    expect(result).toEqual({ ok: false, provider: "openai", reason: "consent-required" });
  });

  it("passes once that provider has been consented to", () => {
    const result = checkGenerationGate({
      selection: { ...LOCAL, text: "openai" },
      consent: { openai: true },
      hasApiKey: allKeys,
    });
    expect(result).toEqual({ ok: true });
  });

  it("blocks on the voice provider too, not just text", () => {
    const result = checkGenerationGate({
      selection: { ...LOCAL, voice: "elevenlabs" },
      consent: {},
      hasApiKey: allKeys,
    });
    expect(result).toEqual({ ok: false, provider: "elevenlabs", reason: "consent-required" });
  });

  it("does not look at the image provider (画像生成はこの論点 のスコープ外)", () => {
    // 画像は生成フローに乗っていない。ここで止めると文言・音声の生成まで巻き添えになる。
    const result = checkGenerationGate({
      selection: { ...LOCAL, image: "stability-ai" },
      consent: {},
      hasApiKey: noKeys,
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("generationGate / APIキー未設定で外部プロバイダーを選んだ場合 [異常系]", () => {
  it("blocks on the missing key before asking for consent", () => {
    // キーが無ければそもそも送信できない。先にキーを案内する
    // (core/providers/consent.ts の優先順と揃える)。
    const result = checkGenerationGate({
      selection: { ...LOCAL, text: "openai" },
      consent: {},
      hasApiKey: noKeys,
    });
    expect(result).toEqual({ ok: false, provider: "openai", reason: "missing-api-key" });
  });

  it("asks per provider, not globally", () => {
    // openai のキーはあるが anthropic には無い、という状態を正しく見分ける。
    const result = checkGenerationGate({
      selection: { ...LOCAL, text: "anthropic" },
      consent: { anthropic: true },
      hasApiKey: (id) => id === "openai",
    });
    expect(result).toEqual({ ok: false, provider: "anthropic", reason: "missing-api-key" });
  });
});

describe("generationGate / 同意はプロバイダー単位で 1 回のみ", () => {
  it("reports the text provider first when both are blocked", () => {
    // 生成はテキスト → 音声の順に走る。止まる順もそれに合わせる(先に出すダイアログが決まる)。
    const result = checkGenerationGate({
      selection: { text: "openai", voice: "elevenlabs", image: "local-sdcpp" },
      consent: {},
      hasApiKey: allKeys,
    });
    expect(result).toEqual({ ok: false, provider: "openai", reason: "consent-required" });
  });

  it("moves on to the voice provider once text is cleared", () => {
    const result = checkGenerationGate({
      selection: { text: "openai", voice: "elevenlabs", image: "local-sdcpp" },
      consent: { openai: true },
      hasApiKey: allKeys,
    });
    expect(result).toEqual({ ok: false, provider: "elevenlabs", reason: "consent-required" });
  });

  it("passes when both external providers are consented to", () => {
    const result = checkGenerationGate({
      selection: { text: "openai", voice: "elevenlabs", image: "local-sdcpp" },
      consent: { openai: true, elevenlabs: true },
      hasApiKey: allKeys,
    });
    expect(result).toEqual({ ok: true });
  });
});
