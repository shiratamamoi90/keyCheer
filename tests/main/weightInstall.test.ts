// main/weightInstall: 補助モード(論点 0072)が、インストーラと同じフォルダの重みの別ファイルを照合して置き場にコピーする。
// 要件: docs/model-weights.md「インストール」(論点 0055)
// 数 GB の本物は使わず、小さな一時ファイルとその sha256 を一覧として渡す。

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { installWeights } from "../../src/main/weightInstall.js";
import { computeFileSha256 } from "../../src/main/textModelCheck.js";
import type { BundledWeightFile } from "../../src/core/shared/bundledWeights.js";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

const FILES: BundledWeightFile[] = [
  {
    id: "text-model",
    sourceName: "text.gguf",
    relativePath: "weights/text/text.gguf",
    sha256: sha("TEXT"),
    byteSize: 4,
  },
  {
    id: "base-model",
    sourceName: "base.st",
    relativePath: "weights/image/base.st",
    sha256: sha("BASE"),
    byteSize: 4,
  },
  {
    id: "lcm-lora",
    sourceName: "lora.st",
    relativePath: "weights/image/lora/lora.st",
    sha256: sha("LORA"),
    byteSize: 4,
  },
];
const CONTENT: Record<string, string> = {
  "text.gguf": "TEXT",
  "base.st": "BASE",
  "lora.st": "LORA",
};

function setup(options: { skip?: string[]; broken?: string[]; freeBytes?: number } = {}) {
  const sourceDir = mkdtempSync(join(tmpdir(), "keycheer-src-"));
  const userDataDir = mkdtempSync(join(tmpdir(), "keycheer-ud-"));
  for (const [name, text] of Object.entries(CONTENT)) {
    if (options.skip?.includes(name)) continue;
    writeFileSync(join(sourceDir, name), options.broken?.includes(name) ? "XXXX" : text);
  }
  const computeSha256 = vi.fn(computeFileSha256);
  const run = () =>
    installWeights({
      sourceDir,
      userDataDir,
      files: FILES,
      computeSha256,
      getFreeBytes: () => options.freeBytes ?? 1_000_000,
    });
  const placed = (): string[] =>
    FILES.map((f) => f.relativePath).filter((p) => existsSync(join(userDataDir, p)));
  const leftovers = (): string[] => listAll(userDataDir).filter((p) => p.endsWith(".part"));
  return { sourceDir, userDataDir, run, placed, leftovers, computeSha256 };
}

function listAll(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listAll(path) : [path];
  });
}

describe("weightInstall / インストーラは重みの別ファイルを照合して置き場にコピーする", () => {
  it("S0055_01 places every weight after its sha256 matches", async () => {
    const { run, placed, userDataDir } = setup();
    const result = await run();
    expect(result.ok).toBe(true);
    expect(placed()).toEqual(FILES.map((f) => f.relativePath));
    expect(readFileSync(join(userDataDir, "weights/text/text.gguf"), "utf8")).toBe("TEXT");
  });
});

describe("weightInstall / 重みの別ファイルが無ければインストールを完了しない [異常系]", () => {
  it("S0055_02 names the missing files and leaves no partly copied weight", async () => {
    const { run, placed, leftovers } = setup({ skip: ["lora.st"] });
    expect(await run()).toEqual({ ok: false, reason: "missing", files: ["lora.st"] });
    expect(placed()).toEqual([]);
    expect(leftovers()).toEqual([]);
  });
});

describe("weightInstall / 照合が通らなければインストールを完了しない [異常系]", () => {
  it("S0055_03 names the mismatched files and does not place them (nor the others of this run)", async () => {
    const { run, placed, leftovers } = setup({ broken: ["base.st"] });
    expect(await run()).toEqual({ ok: false, reason: "mismatch", files: ["base.st"] });
    expect(placed()).toEqual([]);
    expect(leftovers()).toEqual([]);
  });
});

describe("weightInstall / 空き容量が足りなければコピーを始めない [異常系]", () => {
  it("S0055_04 reports insufficient space before copying anything", async () => {
    const { run, placed, computeSha256 } = setup({ freeBytes: 11 });
    expect(await run()).toEqual({
      ok: false,
      reason: "no-space",
      requiredBytes: 12,
      freeBytes: 11,
    });
    expect(placed()).toEqual([]);
    expect(computeSha256).not.toHaveBeenCalled();
  });
});

describe("weightInstall / 更新のインストールでは照合の通る重みをコピーし直さない [境界]", () => {
  it("S0055_06 keeps matching weights and places only the missing or mismatched ones", async () => {
    const { run, userDataDir } = setup();
    const keep = join(userDataDir, "weights/text/text.gguf");
    const broken = join(userDataDir, "weights/image/base.st");
    mkdirSync(dirname(keep), { recursive: true });
    mkdirSync(dirname(broken), { recursive: true });
    writeFileSync(keep, "TEXT");
    writeFileSync(broken, "OLD!");
    const result = await run();
    expect(result).toEqual({
      ok: true,
      kept: ["text.gguf"],
      placed: ["base.st", "lora.st"],
    });
    expect(readFileSync(broken, "utf8")).toBe("BASE");
  });
});
