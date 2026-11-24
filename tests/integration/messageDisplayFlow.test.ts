// 総合(経路): 設定画面で「セリフを表示する」を外す → main の信頼境界で検証して永続化 → 窓へ表示の設定を送り直す →
// 次の応援でセリフを描かず音声だけ鳴らす、を 1 本で通す(論点 0053)。
//
// 単体で既に縛った分岐(値の検証・既定値・描くかの判定)はここで再検査しない。
// ここが守るのは結合部の前提:SetPopupDisplay の値が store と窓(CharacterDisplay)の**両方**に届き、
// 再起動しなくても次の応援から効くこと。総合テストにシナリオ ID は付けない(@.claude/rules/impl-rules.md N-2)。
//
// electron の ipcMain は実プロセスでしか動かないため、登録された handler を捕まえる偽物に置き換える。

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
const { IpcChannel } = await import("../../src/core/shared/ipc.js");
const { applyCharacterDisplay, initialPopupState, showCheer } = await import(
  "../../src/renderer/popupView.js"
);

type StoreLike = Parameters<typeof createAppStore>[0];
type CharacterDisplay = Parameters<typeof applyCharacterDisplay>[1];

const IDLE = "/userData/characters/c/images/idle.png";
const WAV = "/userData/characters/c/voices/m.wav";

function fakeStore(raw: Record<string, unknown>): StoreLike {
  return {
    get: ((key: string) => raw[key]) as StoreLike["get"],
    set: ((key: string, value: unknown) => {
      raw[key] = value;
    }) as StoreLike["set"],
    delete: ((key: string) => {
      delete raw[key];
    }) as StoreLike["delete"],
  };
}

describe("総合: 設定画面でセリフを切ると、再起動しなくても次の応援からセリフを出さず音声だけ鳴らす", () => {
  it("saves shouldShowMessage over IPC, resends the display to the window and hides the next message", () => {
    handlers.clear();
    const raw: Record<string, unknown> = { popup: { shouldAlwaysShow: true } };
    const store = createAppStore(fakeStore(raw));

    // main/index.ts と同じ結線:設定が変わったら窓へ表示の設定を送り直す
    const sentToWindow: CharacterDisplay[] = [];
    const sendCharacterDisplay = (): void => {
      sentToWindow.push({ idleImagePath: IDLE, ...store.loadPopupDisplay() });
    };
    registerIpcHandlers({
      store,
      isOsDark: () => false,
      onConfigUpdated: () => {},
      onPopupDisplayUpdated: sendCharacterDisplay,
      onPopupPointer: () => {},
    });
    sendCharacterDisplay();

    // 起動直後はセリフを出す(既定)
    let popup = applyCharacterDisplay(initialPopupState, sentToWindow.at(-1)!);
    const before = showCheer(popup, cheer(), 1_000);
    expect(before.state.text).toBe("いいペースだね!");

    // 設定画面で「セリフを表示する」を外して保存する
    const result = handlers.get(IpcChannel.SetPopupDisplay)!(
      {},
      { shouldAlwaysShow: true, shouldShowMessage: false },
    );
    expect(result).toEqual({ ok: true });
    expect(raw.popup).toEqual({ shouldAlwaysShow: true, shouldShowMessage: false });

    // 再起動せずに次の応援:セリフは描かず、絵と音声は出す
    popup = applyCharacterDisplay(before.state, sentToWindow.at(-1)!);
    const after = showCheer(popup, cheer(), 10_000);
    expect(after.state.text).toBe("");
    expect(after.state.visible).toBe(true);
    expect(after.playWavPath).toBe(WAV);
  });
});

function cheer() {
  return {
    count: 50,
    kpm: 120,
    speedZone: "normal" as const,
    timeOfDay: "morning" as const,
    type: "regular" as const,
    messageId: "normal_regular_morning-000",
    message: "いいペースだね!",
    wavPath: WAV,
    imagePath: null,
    popupDurationMs: 5000,
  };
}
