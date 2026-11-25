// 総合(経路): メインウィンドウの表示 → 同梱ランタイムを子プロセスで起動 → HTTP の応答を待つ →
// 生成中に隠す(止めない)→ 生成が終わって止める → 表示し直して起動し直す → 終了で止める、を 1 本で通す。
//
// 単体(tests/main/bundledRuntime.test.ts)は子プロセスと HTTP を偽物にしている。ここでは本物の子プロセス
// (node で小さな HTTP サーバーを立てる)と本物の応答の確認(fetch)をつなぎ、起動・応答・停止が実際に起きることを見る。
// :11434 / :50021 は開発機の compose が使っているので、空いているポートを取って同梱ランタイムの代わりにする。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。

import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  createBundledRuntimeController,
  createNodeRuntimeSpawn,
  isRuntimeResponding,
  type BundledRuntime,
} from "../../src/main/bundledRuntime.js";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function fakeRuntime(id: BundledRuntime["id"], port: number): BundledRuntime {
  return {
    id,
    binPath: process.execPath,
    args: [
      "-e",
      `require("node:http").createServer((_q, s) => s.end("ok")).listen(${port}, "127.0.0.1")`,
    ],
    env: {},
    healthUrl: `http://127.0.0.1:${port}/`,
  };
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("総合: 同梱ランタイムはメインウィンドウの表示中と生成中だけ動く", () => {
  it("starts on show, survives hiding during a generation, stops after it and on quit", async () => {
    const runtimes = [
      fakeRuntime("ollama", await freePort()),
      fakeRuntime("voicevox", await freePort()),
    ];
    const isUp = (runtime: BundledRuntime): Promise<boolean> =>
      isRuntimeResponding(runtime.healthUrl, 500);
    const allUp = async (): Promise<boolean> =>
      (await Promise.all(runtimes.map(isUp))).every(Boolean);
    const allDown = async (): Promise<boolean> =>
      (await Promise.all(runtimes.map(isUp))).every((up) => !up);

    const controller = createBundledRuntimeController({
      runtimes,
      exists: () => true,
      spawn: createNodeRuntimeSpawn(),
      isResponding: (url) => isRuntimeResponding(url, 500),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      startTimeoutMs: 10_000,
      pollIntervalMs: 100,
    });

    try {
      // 表示すると起動し、応答が出るまで待つ
      await controller.onMainWindowShown();
      expect(await allUp()).toBe(true);

      // 生成中に隠しても止めない
      await controller.beforeGeneration();
      controller.onMainWindowHidden();
      expect(await allUp()).toBe(true);

      // 生成が終わった時点で隠れているので止める
      controller.onGenerationFinished();
      expect(await waitUntil(allDown)).toBe(true);

      // 表示し直すと改めて起動する
      await controller.onMainWindowShown();
      expect(await allUp()).toBe(true);
    } finally {
      // 終了で必ず止める(テストが失敗しても子プロセスを残さない)
      controller.stopAll();
    }
    expect(await waitUntil(allDown)).toBe(true);
  }, 30_000);
});
