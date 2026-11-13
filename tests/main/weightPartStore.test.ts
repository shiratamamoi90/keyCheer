// main/weightPartStore: 重みの取得の途中のファイルの操作。実際のファイル(一時フォルダ)で確かめる。
// 要件: docs/model-weights.md(論点 0042)

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { createNodeWeightPartStore } from "../../src/main/weightPartStore.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "keycheer-weights-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("weightPartStore / 途中のファイルと置き先", () => {
  it("appends to the part file, hashes it and puts it in place only on commit", async () => {
    const dir = tempDir();
    const dest = join(dir, "lora", "weights.bin");
    const store = createNodeWeightPartStore(dir);

    expect(store.partSize(dest)).toBe(0);
    await store.appendPart(dest, new Uint8Array([1, 2, 3]));
    await store.appendPart(dest, new Uint8Array([4, 5]));

    expect(store.partSize(dest)).toBe(5);
    expect(store.exists(dest)).toBe(false);
    expect(await store.hashPart(dest)).toBe(
      createHash("sha256")
        .update(new Uint8Array([1, 2, 3, 4, 5]))
        .digest("hex"),
    );

    store.commitPart(dest);

    expect(store.exists(dest)).toBe(true);
    expect(store.partSize(dest)).toBe(0);
    expect([...readFileSync(dest)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("continues a part file left by an earlier run and can throw it away", async () => {
    const dir = tempDir();
    const dest = join(dir, "weights.bin");
    await createNodeWeightPartStore(dir).appendPart(dest, new Uint8Array([9, 9]));
    // 取得の途中でアプリを終えた(ファイルは開いたまま残らない前提で、新しく開き直す)
    const store = createNodeWeightPartStore(dir);

    expect(store.partSize(dest)).toBe(2);
    await store.appendPart(dest, new Uint8Array([8]));
    expect(store.partSize(dest)).toBe(3);

    store.resetPart(dest);
    expect(store.partSize(dest)).toBe(0);
    expect(existsSync(dest)).toBe(false);
  });

  it("reports the free space of the weights folder", async () => {
    const store = createNodeWeightPartStore(join(tempDir(), "weights"));

    expect(await store.freeBytes()).toBeGreaterThan(0);
  });
});
