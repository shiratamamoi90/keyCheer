// main/textModelImport: インストール中に、置いた GGUF を Ollama に取り込む(論点 0073)。
// 要件: docs/model-weights.md「インストール」の取り込み(論点 0073)
// Ollama の HTTP API は偽物の fetch、同梱の Ollama の起動は偽物の子プロセスで置き換える。

import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importTextModel } from "../../src/main/textModelImport.js";
import {
  createBundledRuntimeController,
  resolveBundledRuntimes,
} from "../../src/main/bundledRuntime.js";

const GGUF = "GGUF-body";
const SHA = createHash("sha256").update(GGUF).digest("hex");
const BASE = "http://127.0.0.1:11434";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function setup(
  options: {
    isRunning?: boolean;
    existingSha?: string;
    createStatus?: number;
    isReadyOnSpawn?: boolean;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "keycheer-import-"));
  const modelPath = join(dir, "model.gguf");
  writeFileSync(modelPath, GGUF);
  let isUp = options.isRunning ?? false;
  const spawned: string[] = [];
  const killed: string[] = [];
  const calls: Call[] = [];
  const uploaded: string[] = [];

  const [ollama] = resolveBundledRuntimes({
    resourcesDir: "/res",
    userDataDir: "/ud",
    platform: "win32",
  });
  const controller = createBundledRuntimeController({
    runtimes: [ollama!],
    exists: () => true,
    spawn: (command) => {
      spawned.push(command);
      if (options.isReadyOnSpawn ?? true) isUp = true;
      return {
        on: () => {},
        kill: () => {
          killed.push(command);
          isUp = false;
        },
      };
    },
    isResponding: () => Promise.resolve(isUp),
    sleep: () => Promise.resolve(),
    startTimeoutMs: 300,
    pollIntervalMs: 100,
  });

  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown = init?.body;
    if (body !== undefined && url.includes("/api/blobs/") && method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      uploaded.push(Buffer.concat(chunks).toString());
      body = "<stream>";
    } else if (typeof body === "string") {
      body = JSON.parse(body);
    }
    calls.push({ method, url, body });
    if (!isUp) throw new Error("ECONNREFUSED");
    if (url.endsWith("/api/show")) {
      return options.existingSha === undefined
        ? new Response("not found", { status: 404 })
        : Response.json({ modelfile: `FROM /models/blobs/sha256-${options.existingSha}\n` });
    }
    if (url.includes("/api/blobs/") && method === "HEAD")
      return new Response(null, { status: 404 });
    if (url.includes("/api/blobs/")) return new Response(null, { status: 201 });
    if (url.endsWith("/api/create"))
      return new Response("{}", { status: options.createStatus ?? 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const run = () =>
    importTextModel({
      baseUrl: BASE,
      modelPath,
      sha256: SHA,
      fetchFn,
      start: () => controller.beforeGeneration(),
      stop: () => controller.stopAll(),
    });
  return { run, calls, spawned, killed, uploaded };
}

describe("textModelImport / 重みを置いたあと、テキストモデルを Ollama に取り込む", () => {
  it("S0073_01 starts the bundled Ollama, imports the GGUF with the template and stop, then stops it", async () => {
    const { run, calls, spawned, killed } = setup();
    expect(await run()).toEqual({ ok: true, isImported: true });
    expect(spawned).toHaveLength(1);
    const create = calls.find((c) => c.url.endsWith("/api/create"))!;
    expect(create.body).toMatchObject({
      model: "sarashina2.2-3b-instruct",
      files: { "sarashina2.2-3b-instruct-q4_K_M.gguf": `sha256:${SHA}` },
      template:
        "{{ if .System }}<|system|>{{ .System }}</s>{{ end }}<|user|>{{ .Prompt }}</s><|assistant|>",
      parameters: { stop: ["</s>", "<|user|>"] },
    });
    expect(killed).toHaveLength(1);
  });
});

describe("textModelImport / 既に応答のある Ollama があればそれに取り込み、止めない [境界]", () => {
  it("S0073_02 imports into the running Ollama without starting or stopping one", async () => {
    const { run, calls, spawned, killed } = setup({ isRunning: true });
    expect((await run()).ok).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/api/create"))).toBe(true);
    expect(spawned).toEqual([]);
    expect(killed).toEqual([]);
  });
});

describe("textModelImport / 同じモデルが既にあれば取り込み直さない [境界]", () => {
  it("S0073_03 skips the import when the model already uses the same layer", async () => {
    const { run, calls } = setup({ isRunning: true, existingSha: SHA });
    expect(await run()).toEqual({ ok: true, isImported: false });
    expect(calls.some((c) => c.url.includes("/api/blobs/") || c.url.endsWith("/api/create"))).toBe(
      false,
    );
  });
});

describe("textModelImport / 取り込みに失敗したらインストールを完了しない [異常系]", () => {
  it("S0073_04 fails when Ollama does not respond or the import errors, and stops what it started", async () => {
    const unavailable = setup({ isReadyOnSpawn: false });
    expect(await unavailable.run()).toEqual({ ok: false, reason: "ollama-unavailable" });
    expect(unavailable.killed).toHaveLength(1);

    const failing = setup({ createStatus: 500 });
    expect(await failing.run()).toEqual({ ok: false, reason: "import-failed" });
    expect(failing.killed).toHaveLength(1);
  });
});

describe("textModelImport / 取り込みで外部へ通信しない [否定]", () => {
  it("S0073_05 talks only to the Ollama on 127.0.0.1 and sends the GGUF from the local file", async () => {
    const { run, calls, uploaded } = setup();
    await run();
    expect(calls.every((c) => c.url.startsWith("http://127.0.0.1:11434/"))).toBe(true);
    expect(uploaded).toEqual([GGUF]);
  });
});
