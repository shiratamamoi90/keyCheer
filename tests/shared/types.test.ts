// shared/types: 閉じた union のランタイム配列がデータ契約と一致していることを縛る。
// spec: specs/data-model.md「speedZone は 3 値のみ [境界]」「timeOfDay は 4 値のみ [境界]」
//        「プロバイダー識別子の定義域 [境界]」/ specs/integrations.md「プロバイダー識別子(閉じた union)」
// これらの配列は engine(バケットキー生成・バリデーション)の単一参照点なので、
// 値や順序が変わるとプールキー 24 種と保存済みデータの互換が壊れる。

import { describe, it, expect } from "vitest";
import {
  SPEED_ZONES,
  CHEER_TYPES,
  TIMES_OF_DAY,
  TEXT_PROVIDER_IDS,
  VOICE_PROVIDER_IDS,
  IMAGE_PROVIDER_IDS,
} from "../../src/shared/types.js";

describe("shared/types / speedZone は 3 値のみ [境界]", () => {
  it("exposes exactly slow / normal / fast in a deterministic order", () => {
    expect([...SPEED_ZONES]).toEqual(["slow", "normal", "fast"]);
  });
});

describe("shared/types / timeOfDay は 4 値のみ [境界]", () => {
  it("exposes exactly morning / afternoon / evening / night in a deterministic order", () => {
    expect([...TIMES_OF_DAY]).toEqual(["morning", "afternoon", "evening", "night"]);
  });

  it("keeps cheer types to regular / milestone (バケットキーの構成要素)", () => {
    expect([...CHEER_TYPES]).toEqual(["regular", "milestone"]);
  });

  it("yields the 24 scenario combinations the pool contract requires", () => {
    expect(SPEED_ZONES.length * CHEER_TYPES.length * TIMES_OF_DAY.length).toBe(24);
  });
});

describe("shared/types / プロバイダー識別子の定義域 [境界]", () => {
  it("closes the text/voice/image unions to the documented identifiers", () => {
    expect([...TEXT_PROVIDER_IDS]).toEqual(["local-ollama", "openai", "anthropic"]);
    expect([...VOICE_PROVIDER_IDS]).toEqual(["local-voicevox", "openai-tts", "elevenlabs"]);
    expect([...IMAGE_PROVIDER_IDS]).toEqual(["local-sdcpp", "openai-dalle", "stability-ai"]);
  });

  it("does not mix identifiers across kinds", () => {
    const all = [...TEXT_PROVIDER_IDS, ...VOICE_PROVIDER_IDS, ...IMAGE_PROVIDER_IDS];
    expect(new Set(all).size).toBe(all.length);
  });
});
