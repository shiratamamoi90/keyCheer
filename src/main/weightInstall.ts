// weightInstall: 補助モード(論点 0072)が、インストーラと同じフォルダの重みの別ファイルを照合して置き場にコピーする。
// 要件: docs/model-weights.md S0055_01〜04・S0055_06(論点 0055)
//
// 順番:足りない別ファイル → 置き場に照合の通るものがあれば残す → 空き容量(置く分だけ)→ コピーしながら照合。
// 別ファイルが欠けている・容量が足りないことは、数 GB をコピーする前に分かるので先に見る。
// コピーは一時ファイル(.part)に書いて照合してから名前を変え、照合の通らない物を置き場の名前で置かない。
// 1 つでも失敗したら、この回に置いたものと一時ファイルを消す(途中まで揃った状態を残さない)。通信はしない(S0055_05)。

import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BundledWeightFile } from "../core/shared/bundledWeights.js";

export type WeightInstallResult =
  | { ok: true; kept: string[]; placed: string[] }
  | { ok: false; reason: "missing" | "mismatch"; files: string[] }
  | { ok: false; reason: "no-space"; requiredBytes: number; freeBytes: number };

const PART_SUFFIX = ".part";

export async function installWeights(input: {
  sourceDir: string;
  userDataDir: string;
  files: readonly BundledWeightFile[];
  computeSha256: (path: string) => Promise<string>;
  getFreeBytes: (dir: string) => number;
}): Promise<WeightInstallResult> {
  const destOf = (file: BundledWeightFile): string => join(input.userDataDir, file.relativePath);
  const sourceOf = (file: BundledWeightFile): string => join(input.sourceDir, file.sourceName);
  const isIntact = async (path: string, sha256: string): Promise<boolean> =>
    existsSync(path) && (await input.computeSha256(path)) === sha256;

  // S0055_02 足りない別ファイルの名前を示す(コピーの前に)
  const missing = input.files.filter((file) => !existsSync(sourceOf(file)));
  if (missing.length > 0) {
    return { ok: false, reason: "missing", files: missing.map((file) => file.sourceName) };
  }

  // S0055_06 置き場に照合の通るものはコピーし直さない
  const kept: BundledWeightFile[] = [];
  for (const file of input.files) {
    if (await isIntact(destOf(file), file.sha256)) kept.push(file);
  }
  const toPlace = input.files.filter((file) => !kept.includes(file));

  // S0055_04 空き容量が足りなければコピーを始めない。数えるのはこれから置く分だけ(更新では残す分を数えない)
  const requiredBytes = toPlace.reduce((sum, file) => sum + file.byteSize, 0);
  const freeBytes = input.getFreeBytes(input.userDataDir);
  if (freeBytes < requiredBytes) {
    return { ok: false, reason: "no-space", requiredBytes, freeBytes };
  }

  // S0055_01 / S0055_03 一時ファイルにコピーして照合し、通ったものだけを置き場の名前にする
  const staged: BundledWeightFile[] = [];
  const mismatched: BundledWeightFile[] = [];
  try {
    for (const file of toPlace) {
      const part = `${destOf(file)}${PART_SUFFIX}`;
      mkdirSync(dirname(part), { recursive: true });
      copyFileSync(sourceOf(file), part);
      if (await isIntact(part, file.sha256)) staged.push(file);
      else mismatched.push(file);
    }
  } catch (error) {
    removeParts(toPlace, destOf);
    throw error;
  }
  if (mismatched.length > 0) {
    removeParts(toPlace, destOf);
    return { ok: false, reason: "mismatch", files: mismatched.map((file) => file.sourceName) };
  }
  // 全部が照合を通ってから置き場の名前にする — 途中で 1 つ失敗したときに、置いたものを消して回らずに済む
  for (const file of staged) renameSync(`${destOf(file)}${PART_SUFFIX}`, destOf(file));
  return {
    ok: true,
    kept: kept.map((file) => file.sourceName),
    placed: staged.map((file) => file.sourceName),
  };
}

function removeParts(
  files: readonly BundledWeightFile[],
  destOf: (file: BundledWeightFile) => string,
): void {
  for (const file of files) rmSync(`${destOf(file)}${PART_SUFFIX}`, { force: true });
}
