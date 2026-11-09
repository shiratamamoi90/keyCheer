// 総合(経路): 生成 → キャラ画像 3 枚の保存 → 使用中にする → 待機画像 → 応援でその応援種別の画像 →
// 表示時間の後に待機画像へ戻る、を通す(論点 0036)。
//
// 単体で縛った分岐(画像の一部失敗・再開・形式違反・常時表示を切ったとき)はここで再検査しない。
// 守るのは結合部の前提:生成側が書いた画像のパスを、発動経路が同じ規則で見つけて renderer の表示状態まで届くこと。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// 時刻は定数、乱数はシード固定、fs とプロバイダーはインメモリの偽物。実 HTTP・子プロセス・実ファイルは使わない。

import { describe, it, expect } from "vitest";
import { createGenerationRunner } from "../../src/main/characterCreation.js";
import { loadPool, type CharacterFs } from "../../src/main/characterStore.js";
import { createCheerRuntime } from "../../src/main/cheerRuntime.js";
import {
  applyCharacterDisplay,
  initialPopupState,
  showCheer,
  tick,
} from "../../src/renderer/popupView.js";
import type {
  ImageGenerator,
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../../src/core/providers/types.js";
import type { CheerFiredPayload } from "../../src/core/shared/ipc.js";

const USER_DATA = "/userdata";
const CHAR_ID = "char-image";
// 2026-07-25 10:00:00 ローカル時刻(morning)
const T0 = new Date(2026, 6, 25, 10, 0, 0).getTime();

function fakeFs(): CharacterFs & { files: Record<string, string | Uint8Array> } {
  const files: Record<string, string | Uint8Array> = {};
  return {
    files,
    exists: (p) => p in files,
    readFile: (p) => (typeof files[p] === "string" ? (files[p] as string) : undefined),
    writeFile: (p, d) => {
      files[p] = d;
    },
    mkdirRecursive: () => {},
    removeDirRecursive: (p) => {
      for (const k of Object.keys(files)) if (k.startsWith(`${p}/`)) delete files[k];
    },
  };
}

const text: TextGenerator & ImageTagGenerator = {
  id: "local-ollama",
  generateMessages: async ({ scenarioKey, count }) =>
    Array.from({ length: count }, (_, i) => `${scenarioKey}#${i}`),
  // 要求に入ったセリフから画像の種類を見分け、その名前をタグとして返す
  generateImageTags: async ({ prompt }) => ({
    tags: [
      prompt.includes("_milestone_")
        ? "milestone"
        : prompt.includes("_regular_")
          ? "regular"
          : "idle",
    ],
  }),
};
const voice: VoiceSynthesizer = {
  id: "local-voicevox",
  synthesize: async () => new Uint8Array([1]),
};
const image: ImageGenerator = {
  id: "stability-ai",
  generateImages: async ({ prompt }) => [new TextEncoder().encode(prompt)],
};

describe("総合: 生成 → キャラ画像 → 常時表示の窓 → 応援で切り替え → 待機画像に戻る", () => {
  it("生成で保存した画像が、発動経路を通って表示状態の待機画像・応援種別の画像になる", async () => {
    const fs = fakeFs();

    // --- 生成(テキスト → 音声 → 画像)
    const result = await createGenerationRunner().start({
      characterId: CHAR_ID,
      character: { name: "チア", personality: "元気" },
      userDataDir: USER_DATA,
      fs,
      textGenerator: text,
      synthesizer: voice,
      speakerId: 3,
      image: { generator: image, tagGenerator: text, seed: 42, width: 512, height: 768 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.completed.image).toBe("stability-ai");

    // --- 発動経路(index.ts と同じ受け渡し。表示状態は popup.ts と同じく popupView に通す)
    const emitted: CheerFiredPayload[] = [];
    let view = initialPopupState;
    const runtime = createCheerRuntime(
      {
        userDataDir: USER_DATA,
        popupDurationMs: 5000,
        emitCheer: (payload) => emitted.push(payload),
        recordHistory: () => {},
        wavExists: (p) => fs.exists(p),
        imageExists: (p) => fs.exists(p),
        emitCharacterDisplay: ({ idleImagePath }) => {
          view = applyCharacterDisplay(view, { idleImagePath, shouldAlwaysShow: true });
        },
        random: () => 0,
      },
      { regular: 50, milestones: [1000], activeThresholdSec: 60 },
    );
    runtime.setActiveCharacter(CHAR_ID, loadPool(fs, USER_DATA, CHAR_ID));

    // 待機画像:生成側が書いたファイルを指す
    expect(view.visible).toBe(true);
    expect(view.imagePath).toBe(`${USER_DATA}/characters/${CHAR_ID}/images/idle.png`);
    expect(new TextDecoder().decode(fs.files[view.imagePath!] as Uint8Array)).toBe("idle");

    // --- 通常応援でその応援種別の画像に切り替わる
    for (let i = 1; i <= 50; i++) runtime.handleKeyPress(T0 + i);
    expect(emitted).toHaveLength(1);
    view = showCheer(view, emitted[0]!, T0 + 50).state;
    expect(view.text).toBe(emitted[0]!.message);
    expect(new TextDecoder().decode(fs.files[view.imagePath!] as Uint8Array)).toBe("regular");

    // --- 表示時間の後は待機画像に戻り、窓は出たまま
    view = tick(view, T0 + 50 + 5000);
    expect(view.visible).toBe(true);
    expect(view.text).toBe("");
    expect(view.imagePath).toBe(`${USER_DATA}/characters/${CHAR_ID}/images/idle.png`);
  });
});
