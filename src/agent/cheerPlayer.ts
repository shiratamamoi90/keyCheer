// cheerPlayer: 発動時の再生計画(ポップアップ文言 + 再生する wav パス)。
// 発動経路の一部 — プールと保存済み wav のみで完結し、providers・LLM/TTS には一切触れない。
// 実際の音声再生・ポップアップ表示は main / renderer 側。
// spec: specs/data-model.md「音声ファイル」/ specs/cheer-trigger.md
//       (プールからの 1 文選択 + 対応 wav 再生 / 音声ファイル欠損時のフォールバック / キャラ未作成時の発動)

import type { CheerSelection } from "../engine/cheerSelector.js";

// messageId → wav パスの決定的解決(specs/data-model.md)。
// 区切りは "/" 固定(Node の fs API は Windows でも "/" を受け付ける)。
export function resolveWavPath(
  userDataDir: string,
  characterId: string,
  messageId: string,
): string {
  return `${userDataDir}/characters/${characterId}/voices/${messageId}.wav`;
}

export interface CheerPlaybackPlan {
  popupText: string;
  wavPath: string | null; // null = テキストのみ(wav 欠損 / baseline 定型文)
}

// 再生計画に必要なのは「由来 / メッセージ ID / 表示テキスト」だけ。
// engine の `CheerSelection` も main の `CheerEvent` も構造的にこれを満たす。
export type PlayableSelection = Pick<CheerSelection, "source" | "messageId" | "text">;

export interface PlanCheerPlaybackInput {
  selection: PlayableSelection;
  userDataDir: string;
  characterId: string;
  wavExists: (path: string) => boolean;
}

export function planCheerPlayback(input: PlanCheerPlaybackInput): CheerPlaybackPlan {
  const { selection, userDataDir, characterId, wavExists } = input;

  // シナリオ: キャラ未作成時の発動 — baseline 定型文は wav を事前合成していない
  if (selection.source === "baseline") {
    return { popupText: selection.text, wavPath: null };
  }

  // シナリオ: 音声ファイル欠損時のフォールバック — テキストのみ表示(クラッシュしない)
  const path = resolveWavPath(userDataDir, characterId, selection.messageId);
  return { popupText: selection.text, wavPath: wavExists(path) ? path : null };
}
