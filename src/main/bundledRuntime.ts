// bundledRuntime: 同梱ランタイム(Ollama / VOICEVOX ENGINE)の置き場の解決と、起動・停止の管理。
// 要件: docs/integrations.md「同梱ランタイムの起動と停止」S0034_01〜13(論点 0034)
//
// メインウィンドウを表示している間だけ起動し、隠したら止める(生成中は終わるまで待つ)。
// 既に応答がある接続先(開発機の compose のコンテナなど)は使うだけで、起動も停止もしない。
// 応援の発動経路(keyHook / cheerRuntime / core)からは import しない(S0034_10。発動はプールと wav だけで成立する)。

import { spawn } from "node:child_process";
import type { ChildHandleLike } from "../agent/providers/localSdcpp.js";

export type BundledRuntimeId = "ollama" | "voicevox";

export interface BundledRuntime {
  id: BundledRuntimeId;
  binPath: string;
  args: string[];
  env: Record<string, string>;
  // 応答があるかを確かめる先(docs/integrations.md の接続先 :11434 / :50021 のまま変えない)
  healthUrl: string;
}

// S0034_12 127.0.0.1 だけで待ち受ける(ほかの機械から届かない)
const LISTEN_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const VOICEVOX_PORT = 50021;
// Ollama の HTTP API の宛先(補助モードの取り込み。論点 0073)
export const BUNDLED_OLLAMA_URL = `http://${LISTEN_HOST}:${OLLAMA_PORT}`;
// 同梱物の中の置き場(公式の Windows 向け CPU 版の配布物の中身。論点 0034)
const OLLAMA_DIR_NAME = "ollama";
const VOICEVOX_DIR_NAME = "voicevox";
// Ollama のモデルの置き場。アプリを更新しても残るよう userData に置く(論点 0034 決定 6)
const OLLAMA_MODELS_DIR_NAME = "ollama-models";

export function resolveBundledRuntimes(input: {
  resourcesDir: string;
  userDataDir: string;
  platform: string;
}): BundledRuntime[] {
  const extension = input.platform === "win32" ? ".exe" : "";
  return [
    {
      id: "ollama",
      binPath: `${input.resourcesDir}/${OLLAMA_DIR_NAME}/ollama${extension}`,
      args: ["serve"],
      // Ollama は待ち受け先とモデルの置き場を引数ではなく環境変数で受け取る
      env: {
        OLLAMA_HOST: `${LISTEN_HOST}:${OLLAMA_PORT}`,
        OLLAMA_MODELS: `${input.userDataDir}/${OLLAMA_MODELS_DIR_NAME}`,
      },
      healthUrl: `${BUNDLED_OLLAMA_URL}/api/version`,
    },
    {
      id: "voicevox",
      binPath: `${input.resourcesDir}/${VOICEVOX_DIR_NAME}/run${extension}`,
      args: ["--host", LISTEN_HOST, "--port", String(VOICEVOX_PORT)],
      env: {},
      healthUrl: `http://${LISTEN_HOST}:${VOICEVOX_PORT}/version`,
    },
  ];
}

export type RuntimeSpawn = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => ChildHandleLike;

// S0034_11 実行ファイルのパスと引数の配列で起動し、シェルを経由しない(コマンド文字列を組み立てない)
export function createNodeRuntimeSpawn(): RuntimeSpawn {
  return (command, args, env) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, ...env },
    });
    return {
      on: (event, listener) => void child.on(event, listener),
      kill: () => void child.kill(),
    };
  };
}

// 応答があるか(HTTP で 2xx が返るか)。発動経路では呼ばない
export async function isRuntimeResponding(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface BundledRuntimeController {
  onMainWindowShown(): Promise<void>;
  onMainWindowHidden(): void;
  // 生成を始める前に呼ぶ。応答の無いものを起動し、応答が出るまで待つ
  beforeGeneration(): Promise<void>;
  onGenerationFinished(): void;
  // アプリ終了時
  stopAll(): void;
}

export function createBundledRuntimeController(deps: {
  runtimes: readonly BundledRuntime[];
  exists: (path: string) => boolean;
  spawn: RuntimeSpawn;
  isResponding: (url: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  startTimeoutMs: number;
  pollIntervalMs: number;
}): BundledRuntimeController {
  // アプリが起動したものだけを覚える(S0034_05 起動していないものは止めない)
  const owned = new Map<BundledRuntimeId, ChildHandleLike>();
  // 起動して応答を待っている間の約束(表示と生成の開始が重なっても 2 つ起動しない)
  const starting = new Map<BundledRuntimeId, Promise<void>>();
  let isVisible = false;
  let isGenerating = false;

  const stop = (id: BundledRuntimeId): void => {
    const child = owned.get(id);
    owned.delete(id);
    child?.kill();
  };

  const stopOwned = (): void => {
    for (const id of [...owned.keys()]) stop(id);
  };

  const waitUntilResponding = async (runtime: BundledRuntime): Promise<boolean> => {
    for (let waited = 0; waited < deps.startTimeoutMs; waited += deps.pollIntervalMs) {
      // 待っている間に落ちた・止めたら待つのをやめる
      if (!owned.has(runtime.id)) return false;
      if (await deps.isResponding(runtime.healthUrl)) return true;
      await deps.sleep(deps.pollIntervalMs);
    }
    return deps.isResponding(runtime.healthUrl);
  };

  const ensureOne = async (runtime: BundledRuntime): Promise<void> => {
    // S0034_13 同梱ランタイムが無ければ起動を試みない(開発起動)
    if (!deps.exists(runtime.binPath)) return;
    if (owned.has(runtime.id)) return;
    // S0034_02 既に応答があればそれを使う
    if (await deps.isResponding(runtime.healthUrl)) return;

    const child = deps.spawn(runtime.binPath, runtime.args, runtime.env);
    owned.set(runtime.id, child);
    // S0034_07 落ちたら忘れるだけで、自動では起動し直さない。次の表示・生成の開始で改めて試みる(S0034_08)
    const forget = (): void => {
      if (owned.get(runtime.id) === child) owned.delete(runtime.id);
    };
    child.on("close", forget);
    child.on("error", forget);

    // S0034_06 時間上限までに応答が出なければ止めて、未起動のときと同じ扱いにする
    if (!(await waitUntilResponding(runtime)) && owned.get(runtime.id) === child) {
      console.error(`[keycheer] 同梱ランタイム ${runtime.id} が時間内に応答しませんでした`);
      stop(runtime.id);
    }
  };

  const ensureAll = async (): Promise<void> => {
    await Promise.all(
      deps.runtimes.map((runtime) => {
        const pending = starting.get(runtime.id);
        if (pending !== undefined) return pending;
        const started = ensureOne(runtime).finally(() => starting.delete(runtime.id));
        starting.set(runtime.id, started);
        return started;
      }),
    );
  };

  return {
    // S0034_01 表示したとき、応答が無ければ起動する
    async onMainWindowShown() {
      isVisible = true;
      await ensureAll();
      // 起動を待つ間に隠されていたら、ここで止める(生成中でなければ)
      if (!isVisible && !isGenerating) stopOwned();
    },
    // S0034_03 隠したら止める / S0034_04 生成中は終わるまで止めない
    onMainWindowHidden() {
      isVisible = false;
      if (!isGenerating) stopOwned();
    },
    async beforeGeneration() {
      isGenerating = true;
      await ensureAll();
    },
    onGenerationFinished() {
      isGenerating = false;
      if (!isVisible) stopOwned();
    },
    // S0034_09 アプリ終了時に、起動したものを必ず止める(生成中を含む)
    stopAll() {
      stopOwned();
    },
  };
}
