// providerStore: プロバイダー選択と同意フラグの永続化(キャラ作成側だけが使う)。
// 要件: docs/data-model.md「同意フラグ未通過状態の永続化禁止」
//        docs/integrations.md「同意はプロバイダー単位で 1 回のみ」/「プロバイダー設定の保存」
//
// store.ts と分けている理由:store.ts は発動経路(main/index.ts)からも読まれる。
// providers の関心をそこへ集めると「発動経路は providers を知らない」が曖昧になる。
// 本モジュールは発動経路から import しない(CLAUDE.md の不変条件)。
//
// 注:API キー本体はここ(平文 JSON)に書かない(safeStorage 管轄。src/agent/secrets.ts)。

import { validateProviderSelection } from "../core/providers/registry.js";
import { isConsentableProviderId } from "../core/shared/providerDisclosure.js";
import {
  DEFAULT_PROVIDER_SELECTION,
  type ProviderId,
  type ProviderSelection,
} from "../core/shared/types.js";
import type { StoreLike } from "./store.js";

// 値は `true` のみ。未同意は「キーが無い」で表す — false を持ち回ると
// 「false が書かれている = 一度は同意画面を通った」という別の意味を帯びてしまう。
export type PersistedConsent = Partial<Record<ProviderId, true>>;

export type SaveProvidersResult = { ok: true } | { ok: false; errors: string[] };

export interface ProviderStore {
  loadProviders(): ProviderSelection;
  saveProviders(selection: ProviderSelection): SaveProvidersResult;
  loadConsent(): PersistedConsent;
  grantConsent(id: ProviderId): void;
}

interface PersistedProviders {
  selection?: unknown;
  consent?: unknown;
}

export function createProviderStore(store: StoreLike): ProviderStore {
  const read = (): PersistedProviders =>
    (store.get("providers") as PersistedProviders | undefined) ?? {};

  return {
    // シナリオ: プロバイダー設定の保存(不正値は既定へ倒す)
    // JSON 直接編集・旧バージョンの残骸でクラッシュさせない。検証は core の純粋関数に委譲。
    loadProviders() {
      const validated = validateProviderSelection(read().selection);
      return validated.ok ? validated.value : DEFAULT_PROVIDER_SELECTION;
    },

    // 信頼境界:呼び出し側(IPC ハンドラ)で検証済みを前提とせず、ここでも再検証する。
    saveProviders(selection) {
      const validated = validateProviderSelection(selection);
      if (!validated.ok) return { ok: false, errors: validated.errors };
      store.set("providers", { ...read(), selection: validated.value });
      return { ok: true };
    },

    // シナリオ: 同意フラグ未通過状態の永続化禁止
    // JSON を直接編集された場合への防御も兼ねる:既知の外部 ProviderId かつ厳密に true のものだけを拾う。
    // 「未知キー」「true 以外の値」はすべて未同意として捨てる(緩めると同意なし送信の穴になる)。
    loadConsent() {
      const raw = read().consent;
      if (typeof raw !== "object" || raw === null) return {};
      const consent: PersistedConsent = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value === true && isConsentableProviderId(key)) {
          consent[key] = true;
        }
      }
      return consent;
    },

    // シナリオ: 同意はプロバイダー単位で 1 回のみ
    // ここが同意を書く唯一の経路。ダイアログの表示・チェック操作では呼ばない。
    // 選択(selection)には触れない — 同意と選択は独立して残る。
    grantConsent(id) {
      const current = this.loadConsent();
      store.set("providers", { ...read(), consent: { ...current, [id]: true } });
    },
  };
}
