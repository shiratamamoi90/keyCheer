// 総合(経路): キャラクター画面(保存と生成をまとめた画面。論点 0061)で、新規の入力 → 保存 → 生成ボタンが押せる →
// 生成を始める → 一覧で別のキャラクターを選んでも進捗は生成しているキャラクターのもの → 完了で 3 枚を出す。
// mainEntry と同じ受け渡し(一覧の読み直し → 入力を保存した内容にそろえる → 生成ボタンの判定)を純粋関数でつなぐ。
// 単体で縛った分岐(押せない理由の文言・最初の画面)は再検査しない。総合テストにシナリオ ID は付けない。

import { describe, expect, it } from "vitest";
import {
  applyMainScreenEvent,
  buildGenerationHeading,
  canShowGenerationControls,
  initialMainScreenState,
  type MainScreenState,
} from "../../src/renderer/mainScreen.js";
import { progressLabel, resolveGenerateButton } from "../../src/renderer/generationView.js";
import { canShowGeneratedImages } from "../../src/renderer/characterImagesView.js";
import { toCharacterProfile } from "../../src/renderer/characterForm.js";
import type { CharacterListItem } from "../../src/core/shared/ipc.js";

function listItem(id: string, profile: ReturnType<typeof toCharacterProfile>): CharacterListItem {
  return {
    id,
    ...profile,
    hasPool: false,
    isGenerating: false,
    isActive: false,
    hasProfileChanged: false,
    images: {},
  };
}

describe("総合: キャラクター画面で保存してから生成する", () => {
  it("保存するまで生成できず、保存すると生成でき、進捗と結果は生成したキャラクターのものとして出る", () => {
    let state: MainScreenState = applyMainScreenEvent(initialMainScreenState(), {
      type: "window-shown",
      items: [],
    });
    expect(state.screen).toBe("character");

    // 新規の入力(前後に空白)→ まだ押せない
    const form = { name: " チア ", personality: "元気", speakerId: 2 };
    expect(
      resolveGenerateButton({ generation: state.generation, editing: null, form }).isEnabled,
    ).toBe(false);

    // 保存 → 一覧を読み直し、入力を保存した内容(空白を落としたもの)にそろえる → 押せる
    const saved = listItem("char-c", toCharacterProfile(form));
    const other = listItem("char-d", { name: "シズク", personality: "静か", voicevoxSpeakerId: 8 });
    state = applyMainScreenEvent(state, { type: "characters-loaded", items: [saved, other] });
    const savedForm = { name: saved.name, personality: saved.personality, speakerId: 2 };
    expect(
      resolveGenerateButton({ generation: state.generation, editing: saved, form: savedForm }),
    ).toEqual({ isEnabled: true, notice: null });

    // 生成を始める → 進む。一覧で別のキャラクター(D)を選んでも、進捗は C のもの
    state = applyMainScreenEvent(state, { type: "generation-started", characterId: "char-c" });
    state = applyMainScreenEvent(state, {
      type: "generation",
      payload: { type: "progress", phase: "voice", done: 3, total: 48 },
    });
    expect(canShowGenerationControls(state.screen, state.generation)).toBe(true);
    expect(buildGenerationHeading(state)).toBe("チア の生成");
    const otherForm = { name: other.name, personality: other.personality, speakerId: 8 };
    expect(
      resolveGenerateButton({ generation: state.generation, editing: other, form: otherForm })
        .isEnabled,
    ).toBe(false);

    // 完了 → 結果の文言と C の 3 枚を出す
    state = applyMainScreenEvent(state, {
      type: "generation",
      payload: {
        type: "done",
        synthesized: 48,
        missing: 0,
        images: { saved: 3, total: 3, unavailableReason: null },
      },
    });
    expect(progressLabel(state.generation)).toBe("完了しました(音声 48 本、画像 3 枚)");
    expect(canShowGeneratedImages(state.generation)).toBe(true);
    expect(buildGenerationHeading(state)).toBe("チア の生成");
  });
});
