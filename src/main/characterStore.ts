// characterStore: メッセージプール(pool.json)と wav の永続化。
// spec: changes/0011-pool-generation-and-playback/spec.md /
//       specs/data-model.md「メッセージプール」「保存ルート」「音声ファイル」
//
// fs は注入する(テストで実ファイルを書かないため)。
// wav パスの解決は発動経路と同じ `resolveWavPath` に一本化する — 生成側で別の規約を
// 作ると「書いた場所」と「読む場所」がずれる余地が生まれるため。

import { isValidPool, countMessages, type MessagePool } from "../engine/messagePool.js";
import { resolveWavPath } from "../agent/cheerPlayer.js";
import type { PoolGenerationState } from "../agent/poolGenerator.js";

// main が実 fs を、テストがインメモリの偽物を差し込む最小の面。
export interface CharacterFs {
  exists(path: string): boolean;
  readFile(path: string): string | undefined; // 未存在なら undefined(throw しない)
  writeFile(path: string, data: string | Uint8Array): void;
  mkdirRecursive(path: string): void;
  removeDirRecursive(path: string): void;
}

export const POOL_VERSION = 1;

// 区切りは "/" 固定(resolveWavPath と同じ理由 — Node の fs API は Windows でも受け付ける)
export function characterDir(userDataDir: string, characterId: string): string {
  return `${userDataDir}/characters/${characterId}`;
}

export function poolPath(userDataDir: string, characterId: string): string {
  return `${characterDir(userDataDir, characterId)}/pool.json`;
}

export function voicesDir(userDataDir: string, characterId: string): string {
  return `${characterDir(userDataDir, characterId)}/voices`;
}

// シナリオ: ローカル生成でプールと wav が揃う
// completion も一緒に保存する(中断・再開のため。specs/data-model.md)。
export function savePool(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
  state: PoolGenerationState,
): void {
  fs.mkdirRecursive(characterDir(userDataDir, characterId));
  fs.writeFile(
    poolPath(userDataDir, characterId),
    JSON.stringify(
      {
        characterId,
        version: POOL_VERSION,
        buckets: state.pool.buckets,
        completion: state.completion,
      },
      null,
      2,
    ),
  );
}

// シナリオ: 壊れた pool.json を読んだ場合 [異常系] / pool.json が存在しない場合
// どちらも throw せず null を返す。呼び出し側は baseline 定型文へ落ちる。
export function loadPool(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
): MessagePool | null {
  const raw = fs.readFile(poolPath(userDataDir, characterId));
  if (raw === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // バケット構造の契約は engine の isValidPool が正本(検証を二重に持たない)
  if (!isValidPool(parsed)) return null;

  const pool = { characterId, version: POOL_VERSION, buckets: parsed.buckets };
  // シナリオ: 中身が空のプールは無効として扱う [境界]
  // 生成失敗時も部分結果は再開のために保存するため、24 バケットすべてが空の
  // pool.json が残りうる。構造は妥当でも 1 文も無いプールは使えないので null にし、
  // 応援は baseline 定型文へ落とす(1 文でもあれば中断の途中経過として活かす)。
  if (countMessages(pool) === 0) return null;
  return pool;
}

// シナリオ: 保存先のパス契約 [境界]
// voiceSynth の writeWav に渡す。パス解決は resolveWavPath に委譲する。
export function createWavWriter(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
): (messageId: string, bytes: Uint8Array) => Promise<void> {
  let ensured = false;
  return async (messageId, bytes) => {
    if (!ensured) {
      fs.mkdirRecursive(voicesDir(userDataDir, characterId));
      ensured = true;
    }
    fs.writeFile(resolveWavPath(userDataDir, characterId, messageId), bytes);
  };
}

// シナリオ: 既にプールがある状態で再生成 — 古い wav を残さない
export function clearVoices(fs: CharacterFs, userDataDir: string, characterId: string): void {
  fs.removeDirRecursive(voicesDir(userDataDir, characterId));
}
