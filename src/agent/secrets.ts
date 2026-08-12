// secrets: API キーを OS セキュアストレージ(Electron safeStorage)経由で暗号化保存する。
// 要件: docs/integrations.md「API キーは平文 JSON に出ない [不変条件]」/ docs/data-model.md「API キー」
// 不変条件: electron-store の平文 JSON にはキー本体を書かない。暗号化不可なら保存しない(平文フォールバック禁止)。
// safeStorage と永続化バックエンドは注入(main プロセスが実物を渡す)。

import type { ProviderId } from "../core/shared/types.js";

// Electron safeStorage の必要部分だけを型で表す(依存を薄く保つ)
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

// 暗号化済みブロブの永続化先(electron-store の平文 JSON とは別ファイル/別ストア)
export interface SecretBackend {
  get(id: string): string | undefined;
  set(id: string, value: string): void;
  has(id: string): boolean;
  delete(id: string): void;
}

// キー識別子の規約(docs/data-model.md)
export function apiKeyIdentifier(provider: ProviderId | string): string {
  return `keycheer.api-key.${provider}`;
}

export interface SecretStore {
  setApiKey(provider: ProviderId | string, key: string): void;
  getApiKey(provider: ProviderId | string): string | null;
  hasApiKey(provider: ProviderId | string): boolean;
  deleteApiKey(provider: ProviderId | string): void;
}

export function createSecretStore(deps: {
  safeStorage: SafeStorageLike;
  backend: SecretBackend;
}): SecretStore {
  const { safeStorage, backend } = deps;

  return {
    setApiKey(provider, key) {
      // 暗号化が使えないなら保存を拒否する(平文で書かない — 不変条件)
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          "safeStorage による暗号化が利用できないため API キーを保存できません(平文保存は行いません)",
        );
      }
      const encrypted = safeStorage.encryptString(key);
      // バックエンドは文字列ストアなので base64 で格納(平文は含まれない)
      backend.set(apiKeyIdentifier(provider), encrypted.toString("base64"));
    },

    getApiKey(provider) {
      const stored = backend.get(apiKeyIdentifier(provider));
      if (stored === undefined) return null;
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    },

    hasApiKey(provider) {
      return backend.has(apiKeyIdentifier(provider));
    },

    deleteApiKey(provider) {
      backend.delete(apiKeyIdentifier(provider));
    },
  };
}
