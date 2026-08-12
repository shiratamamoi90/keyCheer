import { describe, it, expect, vi } from "vitest";
import { createSecretStore, apiKeyIdentifier } from "../../src/agent/secrets.js";

// 要件: docs/integrations.md「API キーは平文 JSON に出ない [不変条件]」/ docs/data-model.md「API キー」
//   Electron safeStorage 経由で暗号化保存。electron-store の JSON にはキー本体を書かない。
// safeStorage と永続化バックエンドは注入。fake safeStorage は base64 で可逆変換する。

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    // 実 safeStorage は Buffer を返すが、契約上は「平文とは異なる不透明バイト列」であればよい
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (buf: Buffer) => buf.toString("utf8").replace(/^enc:/, ""),
  };
}

// 永続化バックエンド(= ディスク上の暗号化ストア。electron-store の平文 JSON とは別物)
function memoryBackend() {
  const map = new Map<string, string>();
  return {
    map,
    get: (id: string) => map.get(id),
    set: (id: string, value: string) => void map.set(id, value),
    has: (id: string) => map.has(id),
    delete: (id: string) => void map.delete(id),
  };
}

describe("secrets / キー識別子の規約", () => {
  it("uses keycheer.api-key.<provider>", () => {
    expect(apiKeyIdentifier("openai")).toBe("keycheer.api-key.openai");
    expect(apiKeyIdentifier("elevenlabs")).toBe("keycheer.api-key.elevenlabs");
  });
});

describe("secrets / API キーは平文 JSON に出ない [不変条件]", () => {
  it("S0015_07 API キーが平文 JSON に出ない: stores only ciphertext; plaintext never reaches the backend", () => {
    const backend = memoryBackend();
    const safeStorage = fakeSafeStorage();
    const store = createSecretStore({ safeStorage, backend });

    const PLAINTEXT = "sk-supersecret-1234567890";
    store.setApiKey("openai", PLAINTEXT);

    // バックエンドに保存された全内容を走査し、平文が現れないことを確認
    const persisted = JSON.stringify([...backend.map.entries()]);
    expect(persisted).not.toContain(PLAINTEXT);
    // 保存キーは識別子規約に従う
    expect(backend.has("keycheer.api-key.openai")).toBe(true);
  });

  it("S0016_05 round-trips the key via safeStorage decrypt", () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(), backend: memoryBackend() });
    store.setApiKey("openai", "sk-abc");
    expect(store.getApiKey("openai")).toBe("sk-abc");
  });

  it("hasApiKey reflects presence; getApiKey returns null when absent", () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(), backend: memoryBackend() });
    expect(store.hasApiKey("openai")).toBe(false);
    expect(store.getApiKey("openai")).toBeNull();
    store.setApiKey("openai", "sk-abc");
    expect(store.hasApiKey("openai")).toBe(true);
  });

  it("deleteApiKey removes it", () => {
    const store = createSecretStore({ safeStorage: fakeSafeStorage(), backend: memoryBackend() });
    store.setApiKey("openai", "sk-abc");
    store.deleteApiKey("openai");
    expect(store.hasApiKey("openai")).toBe(false);
  });
});

describe("secrets / 暗号化が使えない環境 [異常系]", () => {
  it("refuses to store (throws) rather than writing plaintext when encryption is unavailable", () => {
    const backend = memoryBackend();
    const encryptString = vi.fn();
    const store = createSecretStore({
      safeStorage: { ...fakeSafeStorage(false), encryptString },
      backend,
    });
    expect(() => store.setApiKey("openai", "sk-abc")).toThrow();
    expect(encryptString).not.toHaveBeenCalled(); // 暗号化を試みない
    expect(backend.map.size).toBe(0); // 平文フォールバックで保存しない
  });
});
