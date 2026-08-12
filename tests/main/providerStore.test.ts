// main/providerStore: プロバイダー選択と同意の永続化。
// 要件: docs/data-model.md「同意フラグ未通過状態の永続化禁止」
//        docs/integrations.md「同意はプロバイダー単位で 1 回のみ」
//
// store.ts と分けている理由:store.ts は発動経路(main/index.ts)からも読まれる。
// providers の関心をそこへ集めると「発動経路は providers を知らない」が曖昧になる。
// 本モジュールはキャラ作成側だけが使う。

import { describe, it, expect } from "vitest";
import { createProviderStore } from "../../src/main/providerStore.js";
import type { StoreLike } from "../../src/main/store.js";
import { DEFAULT_PROVIDER_SELECTION } from "../../src/core/shared/types.js";

function fakeStore(initial: Record<string, unknown> = {}): StoreLike & {
  raw: Record<string, unknown>;
} {
  const raw: Record<string, unknown> = { ...initial };
  return {
    raw,
    get: ((key: string) => raw[key]) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
  };
}

describe("providerStore / 同意フラグ未通過状態の永続化禁止", () => {
  it("S0015_08 reads consent as empty when nothing was ever granted", () => {
    // ダイアログを出しただけ・表示中に強制終了、のいずれでも同意は生まれない。
    expect(createProviderStore(fakeStore()).loadConsent()).toEqual({});
  });

  it("treats every provider as not consented on a fresh store", () => {
    const consent = createProviderStore(fakeStore()).loadConsent();
    for (const id of ["openai", "anthropic", "elevenlabs", "stability-ai"] as const) {
      expect(consent[id], id).not.toBe(true);
    }
  });

  it("persists consent only through an explicit grant", () => {
    const store = createProviderStore(fakeStore());
    store.grantConsent("openai");
    expect(store.loadConsent().openai).toBe(true);
    expect(store.loadConsent().anthropic).toBeUndefined();
  });

  it("keeps a granted provider consented across a reload", () => {
    const fake = fakeStore();
    createProviderStore(fake).grantConsent("anthropic");
    // 再起動相当:同じ永続データから作り直す。
    expect(createProviderStore(fake).loadConsent().anthropic).toBe(true);
  });

  it("drops a `true` that was hand-written into the JSON for an unknown key", () => {
    // JSON 直接編集への防御。未知キーの true を同意として拾わない。
    const store = createProviderStore(
      fakeStore({ providers: { consent: { "not-a-provider": true } } }),
    );
    expect(store.loadConsent()).toEqual({});
  });

  it("ignores non-boolean consent values written into the JSON", () => {
    const store = createProviderStore(fakeStore({ providers: { consent: { openai: "yes" } } }));
    expect(store.loadConsent().openai).not.toBe(true);
  });

  it("keeps the selection untouched when granting consent", () => {
    const fake = fakeStore();
    const store = createProviderStore(fake);
    store.saveProviders({ text: "openai", voice: "local-voicevox", image: "local-sdcpp" });
    store.grantConsent("openai");
    expect(store.loadProviders().text).toBe("openai");
  });
});

describe("providerStore / プロバイダー設定の保存", () => {
  it("defaults to the local set when nothing is stored", () => {
    // CLAUDE.md: 既定はローカル一式。外部が既定になると同意なし送信の余地が生まれる。
    expect(createProviderStore(fakeStore()).loadProviders()).toEqual(DEFAULT_PROVIDER_SELECTION);
  });

  it("round-trips a valid selection", () => {
    const fake = fakeStore();
    const selection = { text: "anthropic", voice: "elevenlabs", image: "stability-ai" } as const;
    createProviderStore(fake).saveProviders(selection);
    expect(createProviderStore(fake).loadProviders()).toEqual(selection);
  });

  it("falls back to the local defaults when the stored value is invalid [異常系]", () => {
    // JSON 直接編集・旧バージョンの残骸。不正値でクラッシュせず既定へ倒す。
    const store = createProviderStore(
      fakeStore({ providers: { selection: { text: "nope", voice: 1, image: null } } }),
    );
    expect(store.loadProviders()).toEqual(DEFAULT_PROVIDER_SELECTION);
  });

  it("rejects an invalid selection instead of persisting it", () => {
    const fake = fakeStore();
    const store = createProviderStore(fake);
    const result = store.saveProviders({ text: "nope" } as never);
    expect(result.ok).toBe(false);
    // 生の永続データを見る。loadProviders() 越しだと不正値が書かれていても
    // 読み出し側の fallback に隠れてしまい、このシナリオを縛れない。
    expect(fake.raw["providers"]).toBeUndefined();
    expect(store.loadProviders()).toEqual(DEFAULT_PROVIDER_SELECTION);
  });

  it("keeps consent untouched when the selection changes", () => {
    // 「一度同意した openai は再度ダイアログを出さない」— 選択の変更で消さない。
    const fake = fakeStore();
    const store = createProviderStore(fake);
    store.grantConsent("openai");
    store.saveProviders({ text: "anthropic", voice: "local-voicevox", image: "local-sdcpp" });
    expect(store.loadConsent().openai).toBe(true);
  });
});
