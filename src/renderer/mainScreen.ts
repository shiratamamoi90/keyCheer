// mainScreen: メインウィンドウの画面(タブ)の状態遷移と、各画面に並べる一覧(純粋関数)。
// spec: docs/main-window.md「メインウィンドウの画面」(論点 0033)
//
// DOM 操作・IPC 購読は mainEntry 側の I/O グルー。ここは「どの画面を出すか」「何を並べるか」だけを持つ。
// core 実装 / providers / agent は import しない(renderer は「使う側」に留める)。

import type { CharacterListItem, GenerationProgressPayload } from "../core/shared/ipc.js";
import {
  initialGenerationState,
  applyGenerationEvent,
  type GenerationViewState,
} from "./generationView.js";
import type { CharacterFormInput } from "./characterForm.js";

export const MAIN_SCREENS = ["save", "generate", "switch", "settings"] as const;
export type MainScreen = (typeof MAIN_SCREENS)[number];

export interface MainScreenState {
  screen: MainScreen;
  items: CharacterListItem[];
  generation: GenerationViewState;
  // 保存画面の書きかけの入力。保存するまで items には入らない
  draft: CharacterFormInput | null;
}

export type MainScreenEvent =
  // 非表示から表示になった(main が Electron の show で知らせる。表示中に重ねて表示要求が来ても出ない)
  | { type: "window-shown"; items: CharacterListItem[] }
  | { type: "tab-selected"; screen: MainScreen }
  | { type: "characters-loaded"; items: CharacterListItem[] }
  | { type: "generation"; payload: GenerationProgressPayload };

export function initialMainScreenState(): MainScreenState {
  return { screen: "save", items: [], generation: initialGenerationState(), draft: null };
}

// S0033_02 0 件なら保存 / S0033_03 プールのあるものがあれば切り替え / S0033_04 それ以外は生成
// 一番多い「選び直すだけ」の利用で回り道をさせず、初回は何から始めるかを示すため(論点 0033)。
export function resolveInitialScreen(items: readonly CharacterListItem[]): MainScreen {
  if (items.length === 0) return "save";
  return items.some((item) => item.hasPool) ? "switch" : "generate";
}

export function applyMainScreenEvent(
  state: MainScreenState,
  event: MainScreenEvent,
): MainScreenState {
  switch (event.type) {
    // S0033_05 表示中のウィンドウは開いている画面を変えない [否定]
    // 最初の画面を決め直すのはここだけ。一覧の読み直しや生成の完了で画面を動かすと、
    // 利用者が開いている画面が勝手に切り替わる。
    case "window-shown":
      return { ...state, items: event.items, screen: resolveInitialScreen(event.items) };
    // S0033_01 4 つの画面をタブでいつでも切り替えられる
    // S0033_06 生成中にほかの画面へ移っても生成は続く — 画面だけを変え、生成の状態には触れない
    case "tab-selected":
      return { ...state, screen: event.screen };
    case "characters-loaded":
      return { ...state, items: event.items };
    case "generation":
      return { ...state, generation: applyGenerationEvent(state.generation, event.payload) };
  }
}

function isGenerationRunning(generation: GenerationViewState): boolean {
  return generation.phase === "text" || generation.phase === "voice";
}

// S0033_07 生成中はほかの画面でも生成タブに「生成中」と示す
export function generationTabBadge(generation: GenerationViewState): string | null {
  return isGenerationRunning(generation) ? "生成中" : null;
}

// S0033_08 進捗と中断は生成画面だけに出す [否定]
// どの生成を止めるのかが進捗と同じ場所で分かるようにするため(生成は同時に 1 件 = 論点 0032)。
export function canShowGenerationControls(
  screen: MainScreen,
  _generation: GenerationViewState,
): boolean {
  return screen === "generate";
}

// S0033_09 生成画面で選べるのは保存済みのキャラクターだけ [否定]
// draft を候補に混ぜると、保存先の id が無いまま生成を始められてしまう。
export function buildGenerationCandidates(state: MainScreenState): CharacterListItem[] {
  return state.items;
}

export interface SwitchListEntry {
  id: string;
  name: string;
  isActive: boolean;
  isSelectable: boolean;
  isGenerating: boolean;
}

// S0033_10 切り替え画面にプールの無いキャラクターを出さない [否定]
// S0033_11 生成中で前回のプールがあるものは選べない形で出す [境界]
// 一覧から消すと、前回のプールで使用中のまま再生成しているときに使用中が見えなくなるため。
export function buildSwitchList(items: readonly CharacterListItem[]): SwitchListEntry[] {
  return items
    .filter((item) => item.hasPool)
    .map((item) => ({
      id: item.id,
      name: item.name,
      isActive: item.isActive,
      isSelectable: !item.isGenerating,
      isGenerating: item.isGenerating,
    }));
}

// S0033_12 プールのあるキャラクターが無ければ切り替え画面でそう示す [境界]
export function switchEmptyNotice(items: readonly CharacterListItem[]): string | null {
  return items.some((item) => item.hasPool) ? null : "生成が済んだキャラクターがありません";
}
