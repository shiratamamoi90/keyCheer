// generationView: 生成ボタンと進捗表示のビューモデル(純粋関数)。
// spec: 論点 0020
//   「生成の進捗が通知される」「生成中に再度生成を開始できない [境界]」
//
// DOM 操作・IPC 購読は mainEntry 側の I/O グルー。ここは状態遷移と表示文言だけを持つ。
// core 実装 / providers / agent は import しない(renderer は「使う側」に留める)。

import type { GenerationImagesSummary, StartGenerationResult } from "../core/shared/ipc.js";

export type GenerationPhaseName = "idle" | "text" | "voice" | "image" | "done" | "failed";

export interface GenerationViewState {
  phase: GenerationPhaseName;
  done: number;
  total: number;
  synthesized: number;
  missing: number;
  // 完了したときの画像の結果。null = 画像の結果が届いていない
  images: GenerationImagesSummary | null;
  reason: string | null;
}

export type GenerationEvent =
  | { type: "progress"; phase: "text" | "voice" | "image"; done: number; total: number }
  | { type: "done"; synthesized: number; missing: number; images?: GenerationImagesSummary }
  | { type: "failed"; reason: string };

export function initialGenerationState(): GenerationViewState {
  return {
    phase: "idle",
    done: 0,
    total: 0,
    synthesized: 0,
    missing: 0,
    images: null,
    reason: null,
  };
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
        images: event.images ?? null,
        reason: null,
      };
    case "failed":
      return { ...state, phase: "failed", reason: event.reason };
  }
}

// 実行中(text / voice / image)は開始できない。キャラ未保存でも開始できない
// (characterId が無いと保存先が決まらないため)。
export function canStartGeneration(
  state: GenerationViewState,
  hasSavedCharacter: boolean,
): boolean {
  if (!hasSavedCharacter) return false;
  return state.phase !== "text" && state.phase !== "voice" && state.phase !== "image";
}

const FAILURE_TEXT: Record<string, string> = {
  "text-generation-failed":
    "メッセージの生成に失敗しました。Ollama が起動しているか確認してください",
  cancelled: "生成を中断しました。もう一度実行すると途中から再開します",
  "already-running": "すでに生成中です",
};

// 画像の工程に進めなかった理由の文言
const IMAGE_UNAVAILABLE_TEXT: Record<string, string> = {
  "runtime-not-installed": "画像生成のモデルの重みがありません",
  "missing-api-key": "画像プロバイダーの API キーがありません",
  "consent-required": "画像プロバイダーへの送信に同意していません",
};

// 完了の文言のうち、画像の部分。画像が欠けても生成は完了だが、欠けたことは必ず見えるようにする
// (S0036_09 / S0036_10 の「エラーを表示する」)。先頭の区切りも返すのは、全部作れたときは音声と並べ、
// 欠けたときは文を切って目立たせるため。
function imagesLabel(images: GenerationImagesSummary | null): string {
  if (images === null) return "";
  if (images.unavailableReason !== null) {
    const why = IMAGE_UNAVAILABLE_TEXT[images.unavailableReason] ?? "画像プロバイダーが使えません";
    return `。画像は作っていません:${why}`;
  }
  if (images.saved === 0) return "。画像は作れませんでした";
  if (images.saved < images.total) {
    return `、画像 ${images.saved} 枚。${images.total - images.saved} 枚は作れませんでした`;
  }
  return `、画像 ${images.saved} 枚`;
}

export const START_GENERATION_LABEL = "応援メッセージ・音声・画像を生成";

export function progressLabel(state: GenerationViewState): string {
  switch (state.phase) {
    case "idle":
      return "";
    case "text":
      return `メッセージを生成中… ${state.done} / ${state.total}`;
    case "voice":
      return `音声を合成中… ${state.done} / ${state.total}`;
    case "image":
      return `画像を生成中… ${state.done} / ${state.total}`;
    case "done":
      return state.missing > 0
        ? `完了しました(音声 ${state.synthesized} 本、${state.missing} 本は音声なし${imagesLabel(state.images)})`
        : `完了しました(音声 ${state.synthesized} 本${imagesLabel(state.images)})`;
    case "failed":
      return FAILURE_TEXT[state.reason ?? ""] ?? "生成に失敗しました";
  }
}

// 作り直す前の確認(論点 0038。docs/main-window.md S0038_07〜09)。
// 作り直しかどうかは main が保存状態から決めて応答で返す(main/generationStart)。
// renderer で判定し直さない — pool.json を読めるのは main だけで、判定を二重に持たないため。
export function shouldConfirmRebuild(
  result: StartGenerationResult,
): result is Extract<StartGenerationResult, { reason: "rebuild-confirmation-required" }> {
  return !result.ok && result.reason === "rebuild-confirmation-required";
}

export const REBUILD_CONFIRMATION_TEXT =
  "応援メッセージ・音声・画像を最初から作り直します。今のものは消えます。作り直しますか?";
