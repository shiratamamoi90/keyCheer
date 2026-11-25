// main/textModelCheck: テキストモデルの GGUF を、生成を始めるたびに sha256 で照合する。
// 要件: docs/model-weights.md(論点 0055 / 0059)
// 2 GB の本物は使わず、小さな一時ファイルと、その sha256 を決められた値として渡す。

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  computeFileSha256,
  isTextModelIntact,
  resolveTextModelPath,
} from "../../src/main/textModelCheck.js";

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function setup(content: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "keycheer-text-model-"));
  const path = join(dir, "model.gguf");
  if (content !== null) writeFileSync(path, content);
  return { dir, path };
}

describe("textModelCheck / 生成を始めるたびにテキストモデルの GGUF を照合する", () => {
  it("S0059_01 computes the sha256 and accepts a matching GGUF", async () => {
    const { path } = setup("gguf-ok");
    const computeSha256 = vi.fn(computeFileSha256);
    expect(
      await isTextModelIntact({ path, expectedSha256: sha256Of("gguf-ok"), computeSha256 }),
    ).toBe(true);
    expect(computeSha256).toHaveBeenCalledWith(path);
  });
});

describe("textModelCheck / テキストモデルが欠けていれば生成を始めない [異常系]", () => {
  it("S0055_08 rejects a missing GGUF and one whose sha256 does not match, without throwing", async () => {
    const missing = setup(null);
    expect(
      await isTextModelIntact({
        path: missing.path,
        expectedSha256: sha256Of("gguf-ok"),
        computeSha256: computeFileSha256,
      }),
    ).toBe(false);
    const broken = setup("gguf-broken");
    expect(
      await isTextModelIntact({
        path: broken.path,
        expectedSha256: sha256Of("gguf-ok"),
        computeSha256: computeFileSha256,
      }),
    ).toBe(false);
  });
});

describe("textModelCheck / 前の照合が通っていても、そのあと壊れたら生成を始めない [否定]", () => {
  it("S0059_02 checks again every time and rejects a GGUF changed after a passing check", async () => {
    const { path } = setup("gguf-ok");
    const input = { path, expectedSha256: sha256Of("gguf-ok"), computeSha256: computeFileSha256 };
    expect(await isTextModelIntact(input)).toBe(true);
    writeFileSync(path, "gguf-ng"); // 大きさは同じ
    expect(await isTextModelIntact(input)).toBe(false);
  });
});

describe("textModelCheck / 照合は Ollama に問い合わせずに置き場だけで判定する [否定]", () => {
  it("S0059_03 decides from the file alone, with no network access in the module", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { path } = setup("gguf-broken");
    await isTextModelIntact({
      path,
      expectedSha256: sha256Of("gguf-ok"),
      computeSha256: computeFileSha256,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(readFileSync("src/main/textModelCheck.ts", "utf8")).not.toMatch(/fetch\(|11434|ollama/i);
  });
});

describe("textModelCheck / 照合はテキストモデルを書き換えない [否定]", () => {
  it("S0059_04 leaves the GGUF content, name and folder unchanged whether it matches or not", async () => {
    for (const expected of [sha256Of("gguf-ok"), sha256Of("other")]) {
      const { dir, path } = setup("gguf-ok");
      const before = statSync(path).mtimeMs;
      await isTextModelIntact({ path, expectedSha256: expected, computeSha256: computeFileSha256 });
      expect(readFileSync(path, "utf8")).toBe("gguf-ok");
      expect(statSync(path).mtimeMs).toBe(before);
      expect(readdirSync(dir)).toEqual(["model.gguf"]);
    }
  });
});

describe("textModelCheck / 置き場", () => {
  it("resolves {userData}/weights/text/sarashina2.2-3b-instruct-q4_K_M.gguf", () => {
    expect(resolveTextModelPath("/userdata")).toBe(
      "/userdata/weights/text/sarashina2.2-3b-instruct-q4_K_M.gguf",
    );
  });
});
