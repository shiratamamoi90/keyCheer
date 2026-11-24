// renderer/mainScreen: メインウィンドウの画面(タブ)の状態遷移と、各画面に並べる一覧(純粋関数)。
// 要件: docs/main-window.md「メインウィンドウの画面」(論点 0033 / 0061)
// DOM 操作・IPC 購読は mainEntry 側の I/O グルー。ここでは「どの画面を出すか」「何を並べるか」だけを縛る。
//
// 一覧の元は main が渡すキャラクターの一覧(id・プロフィール・プールの有無・生成中・使用中)。

import { describe, it, expect } from "vitest";
import {
  MAIN_SCREENS,
  initialMainScreenState,
  applyMainScreenEvent,
  resolveInitialScreen,
  generationTabBadge,
  canShowGenerationControls,
  buildGenerationHeading,
  buildSwitchList,
  switchEmptyNotice,
  type MainScreenState,
} from "../../src/renderer/mainScreen.js";
import { initialGenerationState, applyGenerationEvent } from "../../src/renderer/generationView.js";
import type { CharacterListItem } from "../../src/core/shared/ipc.js";

function item(id: string, over: Partial<CharacterListItem> = {}): CharacterListItem {
  return {
    id,
    name: `名前-${id}`,
    personality: "元気",
    voicevoxSpeakerId: 3,
    hasPool: false,
    isGenerating: false,
    isActive: false,
    hasProfileChanged: false,
    images: {},
    ...over,
  };
}

const IDLE = initialGenerationState();
const GENERATING = applyGenerationEvent(IDLE, {
  type: "progress",
  phase: "voice",
  done: 3,
  total: 48,
});

function stateOn(screen: MainScreenState["screen"]): MainScreenState {
  return { ...initialMainScreenState(), screen };
}

describe("mainScreen / 3 つの画面をタブでいつでも切り替えられる", () => {
  it("S0061_01 switches to any of the three screens from any screen, even while generating", () => {
    expect(MAIN_SCREENS).toEqual(["character", "switch", "settings"]);
    for (const from of MAIN_SCREENS) {
      for (const to of MAIN_SCREENS) {
        const state = { ...stateOn(from), generation: GENERATING };
        expect(applyMainScreenEvent(state, { type: "tab-selected", screen: to }).screen).toBe(to);
      }
    }
  });
});

describe("mainScreen / キャラクターが 0 件ならキャラクター画面を最初に出す", () => {
  it("S0033_02 resolves the character screen for an empty list", () => {
    expect(resolveInitialScreen([])).toBe("character");
  });
});

describe("mainScreen / プールのあるキャラクターがあれば切り替え画面を最初に出す", () => {
  it("S0033_03 resolves the switch screen when at least one character has a pool", () => {
    expect(resolveInitialScreen([item("char-c"), item("char-d", { hasPool: true })])).toBe(
      "switch",
    );
  });
});

describe("mainScreen / 保存済みでもプールのあるものが無ければキャラクター画面を最初に出す [境界]", () => {
  it("S0033_04 resolves the character screen when characters exist but none has a pool", () => {
    expect(resolveInitialScreen([item("char-c"), item("char-d")])).toBe("character");
  });
});

describe("mainScreen / 表示中のウィンドウは開いている画面を変えない [否定]", () => {
  it("S0033_05 keeps the open screen on list refresh and generation completion", () => {
    const state = stateOn("settings");
    const withPool = [item("char-c", { hasPool: true })];

    const refreshed = applyMainScreenEvent(state, { type: "characters-loaded", items: withPool });
    const completed = applyMainScreenEvent(refreshed, {
      type: "generation",
      payload: { type: "done", synthesized: 10, missing: 0 },
    });

    expect(refreshed.screen).toBe("settings");
    expect(completed.screen).toBe("settings");
    // 最初の画面を決め直すのは非表示から表示にしたときだけ
    expect(applyMainScreenEvent(completed, { type: "window-shown", items: withPool }).screen).toBe(
      "switch",
    );
  });
});

describe("mainScreen / 生成中にほかの画面へ移っても生成は続く [否定]", () => {
  it("S0033_06 keeps the generation progress across tab changes", () => {
    const state = { ...stateOn("character"), generation: GENERATING };

    const away = applyMainScreenEvent(state, { type: "tab-selected", screen: "switch" });
    const back = applyMainScreenEvent(away, { type: "tab-selected", screen: "character" });

    expect(away.generation).toEqual(GENERATING);
    expect(back.generation).toEqual(GENERATING);
  });
});

describe("mainScreen / 生成中はほかの画面でもキャラクタータブに「生成中」と示す", () => {
  it("S0033_07 shows the badge while generating and clears it when generation ends", () => {
    const done = applyGenerationEvent(GENERATING, { type: "done", synthesized: 1, missing: 0 });
    const failed = applyGenerationEvent(GENERATING, { type: "failed", reason: "cancelled" });

    expect(generationTabBadge(GENERATING)).toBe("生成中");
    expect(generationTabBadge(done)).toBeNull();
    expect(generationTabBadge(failed)).toBeNull();
    expect(generationTabBadge(IDLE)).toBeNull();
  });
});

describe("mainScreen / 進捗と中断はキャラクター画面だけに出す [否定]", () => {
  it("S0033_08 shows progress and cancel only on the character screen", () => {
    expect(canShowGenerationControls("character", GENERATING)).toBe(true);
    for (const screen of ["switch", "settings"] as const) {
      expect(canShowGenerationControls(screen, GENERATING)).toBe(false);
    }
  });
});

describe("mainScreen / 進捗と結果には生成しているキャラクターの名前を示す [境界]", () => {
  it("S0061_06 names the generating character even after another one is selected for editing", () => {
    const loaded = applyMainScreenEvent(stateOn("character"), {
      type: "characters-loaded",
      items: [item("char-c"), item("char-d")],
    });
    expect(buildGenerationHeading(loaded)).toBeNull();

    const started = applyMainScreenEvent(loaded, {
      type: "generation-started",
      characterId: "char-c",
    });
    const running = applyMainScreenEvent(started, {
      type: "generation",
      payload: { type: "progress", phase: "text", done: 1, total: 24 },
    });
    const done = applyMainScreenEvent(running, {
      type: "generation",
      payload: { type: "done", synthesized: 48, missing: 0 },
    });

    expect(buildGenerationHeading(running)).toBe("名前-char-c の生成");
    expect(buildGenerationHeading(done)).toBe("名前-char-c の生成");
  });
});

describe("mainScreen / 切り替え画面にプールの無いキャラクターを出さない [否定]", () => {
  it("S0033_10 lists characters with a pool, marks the active one and hides the rest", () => {
    const list = buildSwitchList([
      item("char-d", { hasPool: true, isActive: true }),
      item("char-e"),
      item("char-f", { hasPool: true }),
    ]);

    expect(list).toEqual([
      {
        id: "char-d",
        name: "名前-char-d",
        isActive: true,
        isSelectable: true,
        isGenerating: false,
      },
      {
        id: "char-f",
        name: "名前-char-f",
        isActive: false,
        isSelectable: true,
        isGenerating: false,
      },
    ]);
  });
});

describe("mainScreen / 生成中で前回のプールがあるものは選べない形で出す [境界]", () => {
  it("S0033_11 lists a generating character with a previous pool as not selectable", () => {
    const list = buildSwitchList([
      item("char-c", { hasPool: true, isGenerating: true, isActive: true }),
    ]);

    expect(list).toEqual([
      {
        id: "char-c",
        name: "名前-char-c",
        isActive: true,
        isSelectable: false,
        isGenerating: true,
      },
    ]);
  });
});

describe("mainScreen / プールのあるキャラクターが無ければ切り替え画面でそう示す [境界]", () => {
  it("S0033_12 returns an empty list and a notice when no character has a pool", () => {
    const items = [item("char-c"), item("char-d")];

    expect(buildSwitchList(items)).toEqual([]);
    expect(switchEmptyNotice(items)).toBe("生成が済んだキャラクターがありません");
    expect(switchEmptyNotice([item("char-c", { hasPool: true })])).toBeNull();
  });
});

describe("mainScreen / 画像を出しても保存データを変えない [否定]", () => {
  it("S0050_04 selecting a character on the switch screen changes only the selection", () => {
    const items = [item("a", { hasPool: true, isActive: true }), item("b", { hasPool: true })];
    const before = { ...stateOn("switch"), items };
    const snapshot = structuredClone(before);

    const after = applyMainScreenEvent(before, { type: "switch-selected", characterId: "b" });

    expect(after.selectedSwitchId).toBe("b");
    // 使用中は変わらない(使用中にする操作は今のまま)。元の状態も書き換えない
    expect(after.items).toEqual(snapshot.items);
    expect(before).toEqual(snapshot);
  });
});
