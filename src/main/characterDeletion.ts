// characterDeletion: キャラクターの削除(保存データ・生成物・使用中の解除)。
// spec: docs/character-creation.md「複数のキャラクターの保存・編集・削除」(論点 0032)
//
// store・fs・生成中の判定はすべて注入。electron を import しないため決定的にテストできる。

import { characterDir, type CharacterFs } from "./characterStore.js";
import type { DeleteCharacterResult } from "../core/shared/ipc.js";
import type { AppStore } from "./store.js";

export interface CharacterDeletionDeps {
  store: Pick<AppStore, "loadCharacters" | "loadActiveCharacterId" | "removeCharacter">;
  fs: CharacterFs;
  userDataDir: string;
  isGenerating: (characterId: string) => boolean;
  // 使用中のキャラクターを消したときに発動経路へ伝える(再起動なしで baseline 定型文にする)
  onActiveCharacterRemoved: () => void;
}

// S0032_06 キャラクターを削除する
export function deleteCharacter(
  deps: CharacterDeletionDeps,
  characterId: string,
): DeleteCharacterResult {
  if (!deps.store.loadCharacters().some((c) => c.id === characterId)) {
    return { ok: false, reason: "not-found" };
  }
  // S0032_08 生成中のキャラクターは削除できない [否定]
  // 消すと、走っている生成が消えたディレクトリへ pool.json と wav を書き戻してしまう。
  if (deps.isGenerating(characterId)) return { ok: false, reason: "generating" };

  // S0032_10 生成物の削除に失敗した場合 [異常系]
  // 生成物を先に消し、消せたときだけ一覧から外す。逆の順だと、失敗したときに生成物だけが残って
  // 一覧から見えなくなり、利用者が消し直す手段を失う。
  try {
    deps.fs.removeDirRecursive(characterDir(deps.userDataDir, characterId));
  } catch (error) {
    console.error(`[keycheer] ${characterId} の生成物を削除できませんでした`, error);
    return { ok: false, reason: "remove-failed" };
  }

  // S0032_07 使用中のキャラクターを削除すると定型文に戻る
  const wasActive = deps.store.loadActiveCharacterId() === characterId;
  deps.store.removeCharacter(characterId);
  if (wasActive) deps.onActiveCharacterRemoved();
  return { ok: true };
}
