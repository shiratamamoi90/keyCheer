// characterStore: メッセージプール(pool.json)と wav の永続化。
// spec: 論点 0020 /
//       docs/data-model.md「メッセージプール」「保存ルート」「音声ファイル」
//
// fs は注入する(テストで実ファイルを書かないため)。
// wav パスの解決は発動経路と同じ `resolveWavPath` に一本化する — 生成側で別の規約を
// 作ると「書いた場所」と「読む場所」がずれる余地が生まれるため。

import { isValidPool, countMessages, type MessagePool } from "../core/messagePool.js";
import { resolveImagePath, resolveWavPath } from "../agent/cheerPlayer.js";
import type { CharacterImageKind } from "../core/characterImage.js";
import type { PoolGenerationState } from "../agent/poolGenerator.js";
import type { GeneratedProfile } from "../core/shared/types.js";

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

export function imagesDir(userDataDir: string, characterId: string): string {
  return `${characterDir(userDataDir, characterId)}/images`;
}

// S0036_07 生成でプール・wav の後に画像 3 枚を保存する — 書き出し先は resolveImagePath と一本化
// encode は縮小・PNG 化(main が Electron の nativeImage を渡す。S0036_15)。テストでは素通し。
export function createImageWriter(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
  encode: (bytes: Uint8Array) => Uint8Array = (bytes) => bytes,
): (kind: CharacterImageKind, bytes: Uint8Array) => void {
  return (kind, bytes) => {
    fs.mkdirRecursive(imagesDir(userDataDir, characterId));
    fs.writeFile(resolveImagePath(userDataDir, characterId, kind), encode(bytes));
  };
}

// --- 待機画像の情報(local-sdcpp。論点 0046)---
// 応援種別の画像を作るのに要る、縮小前の待機画像・その画像タグ・保存した待機画像の色。
// キャラ画像の置き場(images/)には置かない(docs/data-model.md「画像ファイル」)。中断してから再開するまでの間だけ残し、
// 生成が終わったら消す(S0046_19)。CharacterFs の読み出しが文字列だけなので、1 つの JSON にまとめている。
export interface IdleSourceFile {
  bytes: Uint8Array;
  tags: string;
  palette: (readonly [number, number, number])[];
}

function imageWorkDir(userDataDir: string, characterId: string): string {
  return `${characterDir(userDataDir, characterId)}/image-work`;
}

function idleSourcePath(userDataDir: string, characterId: string): string {
  return `${imageWorkDir(userDataDir, characterId)}/idle-source.json`;
}

export function saveIdleSource(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
  source: IdleSourceFile,
): void {
  fs.mkdirRecursive(imageWorkDir(userDataDir, characterId));
  fs.writeFile(
    idleSourcePath(userDataDir, characterId),
    JSON.stringify({
      tags: source.tags,
      palette: source.palette,
      pngBase64: Buffer.from(source.bytes).toString("base64"),
    }),
  );
}

function isColor(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
  );
}

// 読めない・形が違うものは「残っていない」として扱う(S0046_18 で 3 枚とも作り直す)
export function loadIdleSource(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
): IdleSourceFile | null {
  const text = fs.readFile(idleSourcePath(userDataDir, characterId));
  if (text === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { tags, palette, pngBase64 } = parsed as Record<string, unknown>;
  if (typeof tags !== "string" || typeof pngBase64 !== "string") return null;
  if (!Array.isArray(palette) || !palette.every(isColor)) return null;
  return { tags, palette, bytes: new Uint8Array(Buffer.from(pngBase64, "base64")) };
}

// S0046_19 生成が終わったら縮小前の待機画像を残さない
export function clearIdleSource(fs: CharacterFs, userDataDir: string, characterId: string): void {
  fs.removeDirRecursive(imageWorkDir(userDataDir, characterId));
}

// S0036_13 再生成で画像も作り直し、前の画像を残さない
export function clearImages(fs: CharacterFs, userDataDir: string, characterId: string): void {
  fs.removeDirRecursive(imagesDir(userDataDir, characterId));
}

// シナリオ: ローカル生成でプールと wav が揃う
// completion も一緒に保存する(中断・再開のため。docs/data-model.md)。
// generatedProfile は「生成後に変えた」の比べる元(論点 0032)。無ければ書かない。
export function savePool(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
  state: PoolGenerationState,
  generatedProfile?: GeneratedProfile,
): void {
  fs.mkdirRecursive(characterDir(userDataDir, characterId));
  fs.writeFile(
    poolPath(userDataDir, characterId),
    JSON.stringify(
      {
        characterId,
        version: POOL_VERSION,
        ...(generatedProfile !== undefined ? { generatedProfile } : {}),
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

  // バケット構造の契約は core の isValidPool が正本(検証を二重に持たない)
  if (!isValidPool(parsed)) return null;

  const pool = { characterId, version: POOL_VERSION, buckets: parsed.buckets };
  // シナリオ: 中身が空のプールは無効として扱う [境界]
  // 生成失敗時も部分結果は再開のために保存するため、24 バケットすべてが空の
  // pool.json が残りうる。構造は妥当でも 1 文も無いプールは使えないので null にし、
  // 応援は baseline 定型文へ落とす(1 文でもあれば中断の途中経過として活かす)。
  if (countMessages(pool) === 0) return null;
  return pool;
}

// 生成したときのプロフィールを読む(論点 0032)。旧いプール・壊れた pool.json・形の合わない値は
// undefined — 比べる元が無いものとして扱う(S0032_23)。
export function loadGeneratedProfile(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
): GeneratedProfile | undefined {
  const raw = fs.readFile(poolPath(userDataDir, characterId));
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const profile = (parsed as { generatedProfile?: unknown } | null)?.generatedProfile;
  if (typeof profile !== "object" || profile === null) return undefined;
  const { name, personality, voicevoxSpeakerId } = profile as Record<string, unknown>;
  if (typeof name !== "string" || typeof personality !== "string") return undefined;
  if (typeof voicevoxSpeakerId !== "number") return undefined;
  return { name, personality, voicevoxSpeakerId };
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
