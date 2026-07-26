// generationView: 生成ボタンと進捗表示のビューモデル(純粋関数)。
// spec: changes/0011-pool-generation-and-playback/spec.md
//   「生成の進捗が通知される」「生成中に再度生成を開始できない [境界]」
//
// DOM 操作・IPC 購読は mainEntry 側の I/O グルー。ここは状態遷移と表示文言だけを持つ。
// engine 実装 / providers / agent は import しない(renderer は「使う側」に留める)。

export type GenerationPhaseName = "idle" | "text" | "voice" | "done" | "failed";

export interface GenerationViewState {
  phase: GenerationPhaseName;
  done: number;
  total: number;
  synthesized: number;
  missing: number;
  reason: string | null;
}

export type GenerationEvent =
  | { type: "progress"; phase: "text" | "voice"; done: number; total: number }
  | { type: "done"; synthesized: number; missing: number }
  | { type: "failed"; reason: string };

export function initialGenerationState(): GenerationViewState {
  return { phase: "idle", done: 0, total: 0, synthesized: 0, missing: 0, reason: null };
}

export function applyGenerationEvent(
  state: GenerationViewState,
  event: GenerationEvent,
): GenerationViewState {
  switch (event.type) {
    case "progress":
      return { ...state, phase: event.phase, done: event.done, total: event.total, reason: null };
    case "done":
      return {
        ...state,
        phase: "done",
        synthesized: event.synthesized,
        missing: event.missing,
        reason: null,
      };
    case "failed":
      return { ...state, phase: "failed", reason: event.reason };
  }
}

// 実行中(text / voice)は開始できない。キャラ未保存でも開始できない
// (characterId が無いと保存先が決まらないため)。
export function canStartGeneration(
  state: GenerationViewState,
  hasSavedCharacter: boolean,
): boolean {
  if (!hasSavedCharacter) return false;
  return state.phase !== "text" && state.phase !== "voice";
}

const FAILURE_TEXT: Record<string, string> = {
  "text-generation-failed":
    "メッセージの生成に失敗しました。Ollama が起動しているか確認してください",
  cancelled: "生成を中断しました。もう一度実行すると途中から再開します",
  "already-running": "すでに生成中です",
};

export function progressLabel(state: GenerationViewState): string {
  switch (state.phase) {
    case "idle":
      return "";
    case "text":
      return `メッセージを生成中… ${state.done} / ${state.total}`;
    case "voice":
      return `音声を合成中… ${state.done} / ${state.total}`;
    case "done":
      return state.missing > 0
        ? `完了しました(音声 ${state.synthesized} 本、${state.missing} 本は音声なし)`
        : `完了しました(音声 ${state.synthesized} 本)`;
    case "failed":
      return FAILURE_TEXT[state.reason ?? ""] ?? "生成に失敗しました";
  }
}
