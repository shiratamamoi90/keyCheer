// 総合(経路): インストーラが補助モードを起動 → 別ファイルの重みを照合して置き場にコピー → テキストモデルを Ollama に取り込む →
// 結果のファイルと終了コードを返す → アプリが「重みが揃った」と扱う、を 1 本で通す。
// 本物のファイルのコピーと sha256、本物の HTTP(Ollama の代わりに小さな HTTP サーバー)をつなぐ。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installWeights } from "../../src/main/weightInstall.js";
import { importTextModel } from "../../src/main/textModelImport.js";
import {
  runWeightInstallMode,
  WEIGHT_INSTALL_EXIT_CODE,
} from "../../src/main/weightInstallMode.js";
import { computeFileSha256, isTextModelIntact } from "../../src/main/textModelCheck.js";
import type { BundledWeightFile } from "../../src/core/shared/bundledWeights.js";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const GGUF = "GGUF-flow";
const FILES: BundledWeightFile[] = [
  {
    id: "text-model",
    sourceName: "text.gguf",
    relativePath: "weights/text/text.gguf",
    sha256: sha(GGUF),
    byteSize: GGUF.length,
  },
  {
    id: "base-model",
    sourceName: "base.st",
    relativePath: "weights/image/base.st",
    sha256: sha("BASE"),
    byteSize: 4,
  },
];

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
};

let close: (() => void) | null = null;
afterEach(() => close?.());

async function fakeOllama() {
  const blobs = new Map<string, string>();
  const created: unknown[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === "/api/version") return res.end('{"version":"0.32.13"}');
    if (req.url === "/api/show") return res.writeHead(404).end();
    if (req.url?.startsWith("/api/blobs/")) {
      const digest = req.url.slice("/api/blobs/".length);
      if (req.method === "HEAD") return res.writeHead(blobs.has(digest) ? 200 : 404).end();
      blobs.set(digest, body);
      return res.writeHead(201).end();
    }
    if (req.url === "/api/create") {
      created.push(JSON.parse(body));
      return res.end('{"status":"success"}');
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  close = () => server.close();
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, blobs, created };
}

describe("総合: 補助モードが重みを置き、テキストモデルを取り込み、アプリが揃った状態として扱う", () => {
  it("places the weights, imports the GGUF, reports success and the app accepts the text model", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "keycheer-release-"));
    const userDataDir = mkdtempSync(join(tmpdir(), "keycheer-ud-"));
    writeFileSync(join(sourceDir, "text.gguf"), GGUF);
    writeFileSync(join(sourceDir, "base.st"), "BASE");
    const resultFile = join(sourceDir, "result.json");
    const ollama = await fakeOllama();

    const { exitCode, report } = await runWeightInstallMode({
      args: { sourceDir, resultFile },
      install: (dir) =>
        installWeights({
          sourceDir: dir,
          userDataDir,
          files: FILES,
          computeSha256: computeFileSha256,
          getFreeBytes: () => 1_000_000,
        }),
      importTextModel: () =>
        importTextModel({
          baseUrl: ollama.baseUrl,
          modelPath: join(userDataDir, "weights/text/text.gguf"),
          sha256: sha(GGUF),
          fetchFn: fetch,
          start: () => Promise.resolve(), // 既に応答のある Ollama(起動も停止もしない)
          stop: () => {},
        }),
    });

    expect(exitCode).toBe(WEIGHT_INSTALL_EXIT_CODE.ok);
    expect(report).toEqual({ ok: true, kept: [], placed: ["text.gguf", "base.st"] });
    expect(JSON.parse(readFileSync(resultFile, "utf8"))).toEqual(report);
    // 置き場のファイルの中身が Ollama に届き、テンプレートつきで名前が付いた
    expect(ollama.blobs.get(`sha256:${sha(GGUF)}`)).toBe(GGUF);
    expect(ollama.created).toHaveLength(1);
    // アプリの生成のたびの照合が、置いたテキストモデルを受け入れる
    expect(
      await isTextModelIntact({
        path: join(userDataDir, "weights/text/text.gguf"),
        expectedSha256: sha(GGUF),
        computeSha256: computeFileSha256,
      }),
    ).toBe(true);
  });

  it("returns the missing file names with the matching exit code and imports nothing", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "keycheer-release-"));
    const userDataDir = mkdtempSync(join(tmpdir(), "keycheer-ud-"));
    writeFileSync(join(sourceDir, "base.st"), "BASE");
    const resultFile = join(sourceDir, "result.json");
    const ollama = await fakeOllama();
    const { exitCode } = await runWeightInstallMode({
      args: { sourceDir, resultFile },
      install: (dir) =>
        installWeights({
          sourceDir: dir,
          userDataDir,
          files: FILES,
          computeSha256: computeFileSha256,
          getFreeBytes: () => 1_000_000,
        }),
      importTextModel: () =>
        importTextModel({
          baseUrl: ollama.baseUrl,
          modelPath: "",
          sha256: "",
          fetchFn: fetch,
          start: () => Promise.resolve(),
          stop: () => {},
        }),
    });
    expect(exitCode).toBe(WEIGHT_INSTALL_EXIT_CODE.missing);
    expect(JSON.parse(readFileSync(resultFile, "utf8"))).toEqual({
      ok: false,
      reason: "missing",
      files: ["text.gguf"],
    });
    expect(ollama.created).toEqual([]);
  });
});
