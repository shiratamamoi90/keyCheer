// store: electron-store(JSON 永続化)の薄い I/O アダプタ。
// 設定の検証・既定値補完・マイグレーションは engine の純粋関数に委譲する(main は判定ロジックを持たない)。
// spec: specs/data-model.md「既存設定の読み込みと既定値補完」/「triggers.regular=100 のマイグレーション」
// 注:API キー本体はここ(平文 JSON)に書かない(safeStorage 管轄。src/agent/secrets.ts)。

import Store from "electron-store";
import {
  mergeWithDefaults,
  validateTriggerConfig,
  migrateLegacyDefaults,
  DEFAULT_TRIGGER_CONFIG,
} from "../engine/index.js";
import {
  EMPTY_STATS,
  type TriggerConfig,
  type Stats,
  type CheerHistoryEntry,
} from "../shared/types.js";

// electron-store に持たせる最小スキーマ(Phase 1。character/popup/providers/system は UI 実装時に追加)。
interface PersistedSchema {
  triggers: TriggerConfig;
  stats: Stats;
  meta: AppMeta;
  [key: string]: unknown;
}

// 移行済みフラグ等、ユーザー設定ではない内部状態。
// `regularDefaultMigrated` は旧既定(regular=100)→ 50 の移行を **1 回だけ**にするために持つ。
// これが無いと、ユーザーが意図して 100 を選び直すたびに起動時へ 50 へ戻してしまう
// (specs/data-model.md「以降ユーザーが明示変更した値は尊重する(再上書きしない)」違反)。
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
}

// electron-store 実体を注入可能にして、main 以外(将来のテスト用フェイク)からも組み立て可能にする。
export type StoreLike = Pick<Store<PersistedSchema>, "get" | "set">;

export function createStore(): StoreLike {
  return new Store<PersistedSchema>({
    defaults: { triggers: DEFAULT_TRIGGER_CONFIG, stats: EMPTY_STATS, meta: {} },
  });
}

export function createAppStore(store: StoreLike): AppStore {
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
  };
}
