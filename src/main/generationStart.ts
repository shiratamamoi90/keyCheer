// generationStart: 保存されている pool.json から、生成をどう始めるかを決める。
// spec: docs/pool-generation.md「生成を始めたときに、再開するか作り直すかを決める」/
//       docs/main-window.md「作り直しになるときは、生成を始める前に確認する」(論点 0038)
//
// 読むだけで書かない(S0038_08:確認を求めている間は何も変えない)。
// 再開か作り直しかの判定そのものは core の resolveGenerationMode が持つ。ここは pool.json を読んで渡すだけ。

import { resolveGenerationMode } from "../core/generationMode.js";
import { loadGeneratedProfile, loadPool, poolPath, type CharacterFs } from "./characterStore.js";
import type { PoolGenerationState } from "../agent/poolGenerator.js";
import type { GeneratedProfile } from "../core/shared/types.js";

export type GenerationStart =
  | { kind: "confirmation-required" }
  // resumeFrom が無い = 最初から作る(作り直しも初めての生成も同じ。S0036_13 の経路で古い画像も消す)
  | { kind: "start"; resumeFrom?: PoolGenerationState };

export interface GenerationStartInput {
  fs: CharacterFs;
  userDataDir: string;
  characterId: string;
  profile: GeneratedProfile;
  isRebuildConfirmed: boolean;
}

export function resolveGenerationStart(input: GenerationStartInput): GenerationStart {
  const saved = loadGenerationState(input.fs, input.userDataDir, input.characterId);
  // S0038_05 プールが無い・読めないなら最初から作る [異常系]
  // S0038_09 消すものが無いので確認も出さない
  if (saved === undefined) return { kind: "start" };

  const mode = resolveGenerationMode({
    completion: saved.completion,
    profile: input.profile,
    generatedProfile: loadGeneratedProfile(input.fs, input.userDataDir, input.characterId),
  });

  // S0038_09 再開では何も消えないので確認を出さない
  if (mode === "resume") return { kind: "start", resumeFrom: saved };

  // S0038_07 作り直しになるときは、生成を始める前に確認する
  // S0038_06 画像だけ欠けていても、テキストが揃っていれば作り直し(確認の対象)
  return input.isRebuildConfirmed ? { kind: "start" } : { kind: "confirmation-required" };
}

// pool.json に残した completion から再開の状態を組み立てる(completion は characterStore.savePool が書く)。
// 壊れている・存在しない・completion を読めない場合は undefined(= 最初から生成する)。
function loadGenerationState(
  fs: CharacterFs,
  userDataDir: string,
  characterId: string,
): PoolGenerationState | undefined {
  const pool = loadPool(fs, userDataDir, characterId);
  if (pool === null) return undefined;

  const raw = fs.readFile(poolPath(userDataDir, characterId));
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as { completion?: unknown };
    if (typeof parsed.completion !== "object" || parsed.completion === null) return undefined;
    return {
      pool,
      completion: parsed.completion as PoolGenerationState["completion"],
    };
  } catch {
    return undefined;
  }
}
