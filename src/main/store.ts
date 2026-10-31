// store: electron-store(JSON 永続化)の薄い I/O アダプタ。
// 設定の検証・既定値補完・マイグレーションは core の純粋関数に委譲する(main は判定ロジックを持たない)。
// 要件: docs/data-model.md「既存設定の読み込みと既定値補完」/「triggers.regular=100 のマイグレーション」
// 注:API キー本体はここ(平文 JSON)に書かない(safeStorage 管轄。src/agent/secrets.ts)。

import Store from "electron-store";
import {
  mergeWithDefaults,
  validateTriggerConfig,
  migrateLegacyDefaults,
  DEFAULT_TRIGGER_CONFIG,
} from "../core/index.js";
import { applyGeneratedBy, validateGeneratedBy } from "../core/generatedBy.js";
import {
  EMPTY_STATS,
  DEFAULT_ONBOARDING,
  DEFAULT_SYSTEM_CONFIG,
  DEFAULT_GENERATION_CONFIG,
  MAX_CHARACTER_COUNT,
  type TriggerConfig,
  type Stats,
  type CheerHistoryEntry,
  type Character,
  type GeneratedBy,
  type Onboarding,
  type SystemConfig,
  type GenerationConfig,
} from "../core/shared/types.js";

// electron-store に持たせる最小スキーマ(Phase 1。popup は UI 実装時に追加)。
interface PersistedSchema {
  triggers: TriggerConfig;
  stats: Stats;
  meta: AppMeta;
  characters?: Character[];
  activeCharacterId?: string;
  // 旧形式(論点 0032 より前)。読み込み時に characters へ移して消す(S0032_24)
  character?: Partial<Character>;
  generation?: Partial<GenerationConfig>;
  onboarding?: Onboarding;
  system?: Partial<SystemConfig>;
  [key: string]: unknown;
}

// 移行済みフラグ等、ユーザー設定ではない内部状態。
// `regularDefaultMigrated` は旧既定(regular=100)→ 50 の移行を **1 回だけ**にするために持つ。
// これが無いと、ユーザーが意図して 100 を選び直すたびに起動時へ 50 へ戻してしまう
// (docs/data-model.md「以降ユーザーが明示変更した値は尊重する(再上書きしない)」違反)。
interface AppMeta {
  regularDefaultMigrated?: boolean;
}

export interface AppStore {
  loadTriggerConfig(): { config: TriggerConfig; migrated: boolean };
  saveTriggerConfig(config: TriggerConfig): void;
  loadStats(): Stats;
  appendCheerHistory(entry: CheerHistoryEntry): void;
  recordKeyCount(day: string, delta: number): void;
  addActiveSeconds(day: string, seconds: number): void;
  // 論点 0032: 旧形式の単数 character は初回の読み込みで characters へ移す。
  loadCharacters(): Character[];
  loadActiveCharacterId(): string | undefined;
  // 検証(一覧にある・プールがある・生成中でない)は呼び出し側。store は fs も生成の状態も知らない。
  saveActiveCharacterId(characterId: string): void;
  // 論点 0019: フォームが保存するのはプロフィールのみ(プール・wav・画像は別の論点)。
  // 論点 0020: 保存時に不変の characterId を採番する。
  addCharacter(profile: CharacterProfile): AddCharacterResult;
  updateCharacter(characterId: string, profile: CharacterProfile): UpdateCharacterResult;
  // 一覧から外し、使用中だったら使用中も外す。生成物の削除と生成中の判定は呼び出し側
  // (characterDeletion.ts)— store は fs も生成の状態も知らない。
  removeCharacter(characterId: string): void;
  // 論点 0022: 欠損なく完了した種別だけを generatedBy に記録する(他の種別は残す)。
  recordGeneratedBy(characterId: string, completed: GeneratedBy): void;
  loadGeneration(): GenerationConfig;
  // 検証(真偽値か)は呼び出し側(core/generationConfig)。
  saveGeneration(config: GenerationConfig): void;
  loadSystem(): SystemConfig;
  loadOnboarding(): Onboarding;
  saveOnboarding(onboarding: Onboarding): void;
}

export type CharacterProfile = Pick<Character, "name" | "personality" | "voicevoxSpeakerId">;

export type AddCharacterResult = { ok: true; id: string } | { ok: false; reason: "limit-reached" };
export type UpdateCharacterResult = { ok: true } | { ok: false; reason: "not-found" };

// electron-store 実体を注入可能にして、main 以外(将来のテスト用フェイク)からも組み立て可能にする。
// delete が要るのは、electron-store が set(key, undefined) を受け付けないため(旧 character と
// activeCharacterId を消すときに使う)。
export type StoreLike = Pick<Store<PersistedSchema>, "get" | "set" | "delete">;

// 旧形式の移行で使う外界の情報(論点 0032)。store は fs を持たないので注入する。
export interface AppStoreDeps {
  // そのキャラクターに使えるプールがあるか(S0032_24 / S0032_25)
  hasPool?: (characterId: string) => boolean;
  newId?: () => string;
}

// characterId の採番(論点 0020)。
// `{userData}/characters/{characterId}/` のディレクトリ名になるため、
// パス区切りや Windows で使えない文字が混ざらない文字種だけを使う。
// 名前からは導出しない — 名前を変えるたびに生成済みの wav が迷子になるため。
/** 文字列配列として読めない値(単一文字列・null・数値混じり)は捨てて空配列にする。 */
function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

// S0028_02 旧既定値 gemma2:2b を移行する(論点 0028)
// Gemma は使わない方針なので、この値は利用者が意図して選んだかどうかを区別せずに移す。
// 一致したときだけ移すのは、利用者が自分で入れた別のモデルを壊さないため(S0028_03)。
const LEGACY_DEFAULT_OLLAMA_MODEL = "gemma2:2b";

export function newCharacterId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `char-${Date.now().toString(36)}-${random}`;
}

export function createStore(): StoreLike {
  return new Store<PersistedSchema>({
    defaults: { triggers: DEFAULT_TRIGGER_CONFIG, stats: EMPTY_STATS, meta: {} },
  });
}

export function createAppStore(store: StoreLike, deps: AppStoreDeps = {}): AppStore {
  const hasPool = deps.hasPool ?? (() => false);
  const newId = deps.newId ?? newCharacterId;

  // S0032_24 旧形式の `character` を読み込み時に移行する
  // characters が既にあればそれが正で、旧 character が残っていても作り直さない(S0032_27)。
  // 移行は保存し直して一度きりにする — 毎回メモリ上だけで移すと、次の保存で character が残ったまま
  // characters が書かれ、どちらが正か読み手に分からなくなる。
  function readCharacters(): Character[] {
    const stored = store.get("characters");
    if (Array.isArray(stored)) return stored;

    const legacy = store.get("character");
    if (legacy === undefined) return [];
    // S0032_26 id を持たない旧形式には保存時と同じ規則で採番する
    const migrated = { ...legacy, id: legacy.id ?? newId() } as Character;
    store.set("characters", [migrated]);
    // S0032_25 プールの無いものを使用中にすると、選べない状態(S0032_12)を保存してしまう
    if (hasPool(migrated.id)) store.set("activeCharacterId", migrated.id);
    store.delete("character");
    return [migrated];
  }

  return {
    // 起動時:欠損キー補完 → 検証 → 旧既定(100)からの移行。不正値は既定に置換。
    loadTriggerConfig() {
      const raw = store.get("triggers") as Partial<TriggerConfig> | undefined;
      const merged = mergeWithDefaults(raw ?? {});
      const validated = validateTriggerConfig(merged);
      const base = validated.ok ? validated.value : DEFAULT_TRIGGER_CONFIG;

      // 移行は 1 回だけ。以降 regular=100 はユーザーの明示設定として尊重する。
      const meta = (store.get("meta") as AppMeta | undefined) ?? {};
      const { config, migrated } = migrateLegacyDefaults(
        base,
        meta.regularDefaultMigrated === true,
      );
      if (migrated) {
        store.set("meta", { ...meta, regularDefaultMigrated: true });
      }

      // 補完・移行・置換の結果を書き戻して JSON を正規化する
      store.set("triggers", config);
      return { config, migrated };
    },

    saveTriggerConfig(config) {
      // 呼び出し側(IPC ハンドラ)で validate 済みを前提とするが、防御的に再検証する
      const validated = validateTriggerConfig(config);
      store.set("triggers", validated.ok ? validated.value : DEFAULT_TRIGGER_CONFIG);
    },

    loadStats() {
      return (store.get("stats") as Stats | undefined) ?? EMPTY_STATS;
    },

    appendCheerHistory(entry) {
      const stats = this.loadStats();
      store.set("stats", { ...stats, cheerHistory: [...stats.cheerHistory, entry] });
    },

    recordKeyCount(day, delta) {
      const stats = this.loadStats();
      store.set("stats", {
        ...stats,
        totalKeyCount: stats.totalKeyCount + delta,
        dailyCounts: { ...stats.dailyCounts, [day]: (stats.dailyCounts[day] ?? 0) + delta },
      });
    },

    addActiveSeconds(day, seconds) {
      const stats = this.loadStats();
      store.set("stats", {
        ...stats,
        totalActiveSeconds: stats.totalActiveSeconds + seconds,
        dailyActiveSeconds: {
          ...stats.dailyActiveSeconds,
          [day]: (stats.dailyActiveSeconds[day] ?? 0) + seconds,
        },
      });
    },

    // S0022_09 generatedBy は既定値で補完しない — 欠けた種別は未設定のまま返す。
    // S0022_10 定義域外の値はエラーを出すだけで、直しも捨てもしない(人間の判断で確定。
    // 2026-10-24)。黙って未設定へ落とすと「作った記録が消えた」理由が利用者から見えなくなる。
    loadCharacters() {
      const characters = readCharacters();
      // S0032_28 上限を超える件数を読み込んでも切り詰めない
      // 削ると手で足したキャラクターの生成物が一覧から見えないまま残る。新規保存だけを止める(S0032_03)。
      if (characters.length > MAX_CHARACTER_COUNT) {
        console.error(
          `[keycheer] characters が上限 ${MAX_CHARACTER_COUNT} 件を超えています(${characters.length} 件)`,
        );
      }
      for (const character of characters) {
        if (character.generatedBy === undefined) continue;
        const errors = validateGeneratedBy(character.generatedBy);
        if (errors.length > 0) {
          console.error(`[keycheer] ${character.id} の generatedBy に不正な値があります`, errors);
        }
      }
      return characters;
    },

    loadActiveCharacterId() {
      readCharacters(); // 旧形式なら移行で activeCharacterId が決まる
      return store.get("activeCharacterId");
    },

    saveActiveCharacterId(characterId) {
      store.set("activeCharacterId", characterId);
    },

    // S0032_01 新規保存でキャラクターが追加される
    // S0032_02 既存のキャラクター・activeCharacterId には触れない(末尾に足すだけ)
    addCharacter(profile) {
      const characters = readCharacters();
      // S0032_03 上限の 10 件に達していたら新規保存しない [境界]
      if (characters.length >= MAX_CHARACTER_COUNT) return { ok: false, reason: "limit-reached" };
      // シナリオ: characterId は名前を変えても変わらない [不変条件]
      // 名前から導出しないのは、名前変更で生成済みの wav ディレクトリが迷子になるのを防ぐため。
      const id = newId();
      store.set("characters", [
        ...characters,
        {
          id,
          name: profile.name,
          personality: profile.personality,
          imagePaths: {},
          voicevoxSpeakerId: profile.voicevoxSpeakerId,
        },
      ]);
      return { ok: true, id };
    },

    // S0032_04 既存のキャラクターを編集して保存する
    // 生成物と generatedBy は残す。生成後に変えたかどうかは pool.json の generatedProfile で分かる。
    updateCharacter(characterId, profile) {
      const characters = readCharacters();
      // S0032_05 存在しないキャラクターの編集は拒否する — 新規として足すと上限と id の採番を迂回できる
      if (!characters.some((c) => c.id === characterId)) return { ok: false, reason: "not-found" };
      store.set(
        "characters",
        characters.map((c) =>
          c.id === characterId
            ? {
                ...c,
                name: profile.name,
                personality: profile.personality,
                voicevoxSpeakerId: profile.voicevoxSpeakerId,
              }
            : c,
        ),
      );
      return { ok: true };
    },

    // S0032_07 使用中のキャラクターを削除すると定型文に戻る — 他のキャラクターを自動で使用中にしない
    removeCharacter(characterId) {
      const characters = readCharacters();
      store.set(
        "characters",
        characters.filter((c) => c.id !== characterId),
      );
      if (store.get("activeCharacterId") === characterId) store.delete("activeCharacterId");
    },

    // 保存されていないキャラ(id が一覧に無い)なら何もしない。生成は保存済みキャラに対してのみ。
    recordGeneratedBy(characterId, completed) {
      const characters = readCharacters();
      store.set(
        "characters",
        characters.map((c) =>
          c.id === characterId
            ? { ...c, generatedBy: applyGeneratedBy(c.generatedBy, completed) }
            : c,
        ),
      );
    },

    // S0032_31 `generation.shouldActivateOnComplete` の既定値
    // 真偽値でない保存値は書き換えない(S0022_10 と同じ扱い)。直すと利用者の手書きが理由なく消える。
    loadGeneration() {
      const stored = store.get("generation")?.shouldActivateOnComplete;
      if (stored === undefined) return DEFAULT_GENERATION_CONFIG;
      if (typeof stored !== "boolean") {
        console.error(
          "[keycheer] generation.shouldActivateOnComplete が真偽値ではありません",
          stored,
        );
        return DEFAULT_GENERATION_CONFIG;
      }
      return { shouldActivateOnComplete: stored };
    },

    // シナリオ: system 設定の読み込みと既定値補完
    loadSystem() {
      const raw = (store.get("system") as Partial<SystemConfig> | undefined) ?? {};
      let stored = raw;
      if (raw.ollamaModel === LEGACY_DEFAULT_OLLAMA_MODEL) {
        // 保存し直すのは保存されていた項目だけ。既定値で補完した値まで書き込むと、
        // 以後の既定値の変更が効かなくなる(S0028_05 は他の項目を変えないことを縛る)
        stored = { ...raw, ollamaModel: DEFAULT_SYSTEM_CONFIG.ollamaModel };
        store.set("system", stored);
      }
      return {
        ...DEFAULT_SYSTEM_CONFIG,
        ...stored,
        // 除外設定は手書き編集で壊れやすい(単一文字列を書きがち)。型に適合しない値は
        // 既定へ落とす(docs/data-model.md「既存設定の読み込みと既定値補完」)。
        excludedApps: normalizeStringList(stored.excludedApps),
        excludedKeys: normalizeStringList(stored.excludedKeys),
      };
    },

    // S0033_13 設定画面で生成後に自動で使用中にするかを変える
    // S0033_14 generation だけを書く(キャラクター・使用中・トリガー・統計に触れない)
    saveGeneration(config) {
      store.set("generation", { shouldActivateOnComplete: config.shouldActivateOnComplete });
    },

    loadOnboarding() {
      return (store.get("onboarding") as Onboarding | undefined) ?? DEFAULT_ONBOARDING;
    },

    saveOnboarding(onboarding) {
      store.set("onboarding", onboarding);
    },
  };
}
