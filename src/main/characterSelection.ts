// characterSelection: 使用中のキャラクターの切り替えと、使用中のプールの解決。
// spec: docs/character-selection.md(論点 0032)
//
// store・プールの読み出し・生成の状態はすべて注入。electron を import しないため決定的にテストできる。
// 発動経路(cheerRuntime)へは onActiveCharacterChanged でプールを渡すだけで、
// 発動経路側からこのモジュールを import しない(発動経路は外部依存ゼロ)。

import { hasProfileChangedSinceGeneration } from "../core/generatedProfile.js";
import type { MessagePool } from "../core/messagePool.js";
import type { ActivateCharacterResult, CharacterListItem } from "../core/shared/ipc.js";
import type { GeneratedProfile } from "../core/shared/types.js";
import type { AppStore } from "./store.js";

export interface ActiveCharacterPoolDeps {
  store: Pick<AppStore, "loadCharacters" | "loadActiveCharacterId">;
  loadPool: (characterId: string) => MessagePool | null;
}

export interface CharacterSelectionDeps extends ActiveCharacterPoolDeps {
  store: Pick<AppStore, "loadCharacters" | "loadActiveCharacterId" | "saveActiveCharacterId">;
  generation: { isGenerating: (characterId: string) => boolean };
  onActiveCharacterChanged: (characterId: string, pool: MessagePool) => void;
}

// S0032_15 使用中のキャラクターが無ければ定型文で応援する [境界]
// 未設定・指す先が一覧に無い・プールが無いはどれも null(= baseline 定型文)。保存値は直さない —
// 一時的に読めないだけのプール(書き込み中など)で使用中を消すと、利用者の選択が理由なく消える。
export function loadActiveCharacterPool(
  deps: ActiveCharacterPoolDeps,
): { characterId: string; pool: MessagePool } | null {
  const activeCharacterId = deps.store.loadActiveCharacterId();
  if (activeCharacterId === undefined) return null;
  if (!deps.store.loadCharacters().some((c) => c.id === activeCharacterId)) return null;
  const pool = deps.loadPool(activeCharacterId);
  return pool === null ? null : { characterId: activeCharacterId, pool };
}

// S0032_11 生成済みのキャラクターを使用中にする
// S0032_16 統計とトリガー設定には触れない(activeCharacterId だけを書く)
export function activateCharacter(
  deps: CharacterSelectionDeps,
  raw: unknown,
): ActivateCharacterResult {
  // S0032_17 renderer からの切り替え要求は main 側で検証する [不変条件]
  // 画面で選べないようにしていても、renderer から届いた値は信頼境界の外(security-rules.md)。
  if (typeof raw !== "string") return { ok: false, reason: "invalid-request" };
  if (!deps.store.loadCharacters().some((c) => c.id === raw)) {
    return { ok: false, reason: "not-found" };
  }
  // S0032_13 生成中のキャラクターは使用中にできない [否定]
  // 前回のプールがあっても断る — 生成の終わりにプールと wav が入れ替わり、応援の途中で声が変わるため。
  // S0032_14 他のキャラクターの生成は止めない(ここは対象が生成中かだけを見る)
  if (deps.generation.isGenerating(raw)) return { ok: false, reason: "generating" };
  // S0032_12 プールの無いキャラクターは使用中にできない [否定]
  const pool = deps.loadPool(raw);
  if (pool === null) return { ok: false, reason: "no-pool" };

  deps.store.saveActiveCharacterId(raw);
  deps.onActiveCharacterChanged(raw, pool);
  return { ok: true };
}

export interface CharacterListDeps extends ActiveCharacterPoolDeps {
  generation: { isGenerating: (characterId: string) => boolean };
  loadGeneratedProfile: (characterId: string) => GeneratedProfile | undefined;
}

// 画面に渡すキャラクターの一覧(論点 0033)。どの画面に何を並べるかは renderer が決める
// (renderer/mainScreen.ts)。renderer は fs も生成の状態も持たないので、事実はここで揃えて渡す。
export function loadCharacterList(deps: CharacterListDeps): CharacterListItem[] {
  const activeCharacterId = deps.store.loadActiveCharacterId();
  return deps.store.loadCharacters().map((character) => {
    const profile = {
      name: character.name,
      personality: character.personality,
      voicevoxSpeakerId: character.voicevoxSpeakerId,
    };
    return {
      id: character.id,
      ...profile,
      hasPool: deps.loadPool(character.id) !== null,
      isGenerating: deps.generation.isGenerating(character.id),
      isActive: character.id === activeCharacterId,
      hasProfileChanged: hasProfileChangedSinceGeneration(
        profile,
        deps.loadGeneratedProfile(character.id),
      ),
    };
  });
}
