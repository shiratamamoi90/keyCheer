// 総合(経路): renderer からの設定更新 → main の信頼境界で検証 → 永続化 →
// 発動中の runtime へ即時反映(再起動なしで次の押下から新しい間隔になる)までを 1 本で通す。
//
// 単体で既に縛った分岐(値域の検証規則・既定値補完・移行判定)はここで再検査しない。
// ここが守るのは結合部の前提:IPC ハンドラが core の検証を通し、store と runtime の
// **両方**へ同じ値が届くこと。片方だけに届く実装は単体では気づけない。
// 総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// electron の ipcMain は実プロセスでしか動かないため、登録された handler を捕まえる
// 最小の偽物に置き換える(実物を呼べない外部は fake にする。@.claude/rules/test-rules.md)。

import { describe, it, expect, vi } from "vitest";

type IpcHandler = (event: unknown, arg: unknown) => unknown;

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
  },
}));

const { registerIpcHandlers } = await import("../../src/main/ipc.js");
const { createAppStore } = await import("../../src/main/store.js");
const { createCheerRuntime } = await import("../../src/main/cheerRuntime.js");
const { IpcChannel } = await import("../../src/core/shared/ipc.js");
const { DEFAULT_TRIGGER_CONFIG } = await import("../../src/core/shared/types.js");

type StoreLike = Parameters<typeof createAppStore>[0];
type UpdateResult = { ok: true; config: { regular: number } } | { ok: false; errors: string[] };

const T0 = new Date(2026, 6, 25, 10, 0, 0).getTime();

function fakeStore(initial: Record<string, unknown> = {}): StoreLike & {
  raw: Record<string, unknown>;
} {
  const raw: Record<string, unknown> = { ...initial };
  return {
    raw,
    get: ((key: string) => raw[key]) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
    delete: ((key: string) => {
      delete raw[key];
    }) as StoreLike["delete"],
  };
}

/** 起動時の配線をそのまま組む(main/index.ts と同じ順序・同じ結線)。 */
function bootstrap(initial: Record<string, unknown> = {}) {
  handlers.clear();
  const raw = fakeStore(initial);
  const store = createAppStore(raw);
  const { config } = store.loadTriggerConfig();

  const fired: number[] = [];
  const firedTypes: string[] = [];
  const runtime = createCheerRuntime(
    {
      userDataDir: "/userdata",
      popupDurationMs: 5000,
      emitCheer: (payload) => {
        fired.push(payload.count);
        firedTypes.push(payload.type);
      },
      recordHistory: () => {},
      wavExists: () => false,
      random: () => 0,
    },
    config,
  );

  registerIpcHandlers({
    store,
    isOsDark: () => false,
    onConfigUpdated: (next) => runtime.setConfig(next),
    onPopupDisplayUpdated: () => {},
    onPopupPointer: () => {},
  });

  const invoke = (channel: string, arg?: unknown): unknown => handlers.get(channel)!({}, arg);
  return { raw, store, runtime, fired, firedTypes, invoke, config };
}

describe("総合: 設定更新が永続化と発動間隔の両方に届く", () => {
  it("renderer からの更新後、再起動なしで新しい間隔で発動する", () => {
    const { raw, runtime, fired, invoke } = bootstrap();

    // 起動直後は既定間隔。50 打で 1 回発動する。
    let pressed = 0;
    const press = (times: number): void => {
      for (let i = 0; i < times; i++) runtime.handleKeyPress(T0 + ++pressed);
    };
    press(DEFAULT_TRIGGER_CONFIG.regular);
    expect(fired).toEqual([DEFAULT_TRIGGER_CONFIG.regular]);

    // renderer が間隔を 10 に変更(IPC の実ハンドラを通す)。
    const result = invoke(IpcChannel.UpdateTriggerConfig, {
      regular: 10,
      milestones: [],
      activeThresholdSec: 60,
    }) as UpdateResult;
    expect(result.ok).toBe(true);

    // 永続化されている(次回起動でも同じ値で立ち上がる)。
    expect((raw.raw["triggers"] as { regular: number }).regular).toBe(10);
    expect(createAppStore(raw).loadTriggerConfig().config.regular).toBe(10);

    // かつ、稼働中の発動経路にも届いている(累計カウントは維持したまま)。
    press(10);
    expect(fired).toEqual([DEFAULT_TRIGGER_CONFIG.regular, DEFAULT_TRIGGER_CONFIG.regular + 10]);
  });

  it("不正な設定は境界で弾かれ、永続化も反映もされない", () => {
    const { raw, runtime, fired, invoke } = bootstrap();

    const result = invoke(IpcChannel.UpdateTriggerConfig, {
      regular: -1,
      milestones: "x",
      activeThresholdSec: 0,
    }) as UpdateResult;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);

    // 保存も反映もされていない = 既定間隔のまま発動する。
    expect((raw.raw["triggers"] as { regular: number }).regular).toBe(
      DEFAULT_TRIGGER_CONFIG.regular,
    );
    for (let i = 1; i <= DEFAULT_TRIGGER_CONFIG.regular; i++) runtime.handleKeyPress(T0 + i);
    expect(fired).toEqual([DEFAULT_TRIGGER_CONFIG.regular]);
  });
});

describe("総合: 旧既定の節目を保存していた設定が、起動で新しい節目に移って発動する(論点 0069)", () => {
  it("moves the former default milestones on launch and fires the first milestone at 250", () => {
    const { raw, runtime, fired, firedTypes } = bootstrap({
      triggers: {
        regular: 50,
        milestones: [1000, 5000, 10000, 50000, 100000],
        activeThresholdSec: 60,
      },
    });

    // 起動の読み込みで新しい節目に移り、保存し直されている
    expect((raw.raw["triggers"] as { milestones: number[] }).milestones).toEqual([
      250, 1250, 2500, 12500, 25000,
    ]);

    // 250 打目で節目の応援が出る(50 の倍数でもあるが節目が優先)
    for (let i = 1; i <= 250; i++) runtime.handleKeyPress(T0 + i);
    expect(fired.at(-1)).toBe(250);
    expect(firedTypes.at(-1)).toBe("milestone");
  });
});
