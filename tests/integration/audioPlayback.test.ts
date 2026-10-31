// 総合(経路): ポップアップが渡す wav の URL → main の専用スキーム → {userData} 配下の wav 読み出し、
// までを 1 本で通す(docs/popup.md「wav がある発動で音声も再生する」)。
//
// Windows 実機で、wav が揃っているのに声が出なかった(2026-10-31)。スキームを handle するだけでは
// <audio> はそのスキームから読めず、アプリ起動前に stream 付きの特権スキームとして登録しておく
// 必要があった。部品(パス検証)は単体で縛ってあり、落ちていたのは繋ぎ方なのでここに置く
// (@.claude/rules/test-rules.md「回帰」)。総合テストにシナリオ ID は付けない(N-2)。
//
// electron の protocol / net は実プロセスでしか動かないため、登録内容を捕まえる最小の偽物に置き換える。

import { describe, it, expect, vi } from "vitest";

interface SchemePrivileges {
  scheme: string;
  privileges?: { secure?: boolean; stream?: boolean; supportFetchAPI?: boolean };
}
type ProtocolHandler = (request: { url: string }) => Promise<Response>;

const { registered, handlers, fetched } = vi.hoisted(() => ({
  registered: [] as SchemePrivileges[],
  handlers: new Map<string, (request: { url: string }) => Promise<Response>>(),
  fetched: [] as string[],
}));

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: (schemes: SchemePrivileges[]) => registered.push(...schemes),
    handle: (scheme: string, handler: ProtocolHandler) => handlers.set(scheme, handler),
  },
  net: {
    fetch: async (url: string) => {
      fetched.push(url);
      return new Response("wav");
    },
  },
}));

const { registerAudioSchemePrivileges, registerAudioProtocol } = await import(
  "../../src/main/audioProtocol.js"
);

const USER_DATA_DIR = "/home/user/.config/keycheer";
const WAV_PATH = `${USER_DATA_DIR}/characters/char-1/voices/m-001.wav`;

describe("wav の再生経路", () => {
  it("起動前に stream 付きで登録したスキームから、userData 配下の wav を読み出す", async () => {
    registerAudioSchemePrivileges();
    registerAudioProtocol(USER_DATA_DIR);

    expect(registered).toContainEqual({
      scheme: "keycheer-audio",
      privileges: { secure: true, stream: true, supportFetchAPI: true },
    });

    // renderer(popup.ts)が組み立てる URL と同じ形
    const handler = handlers.get("keycheer-audio");
    expect(handler).toBeDefined();
    const response = await handler!({
      url: `keycheer-audio://play/${encodeURIComponent(WAV_PATH)}`,
    });

    expect(response.status).toBe(200);
    expect(fetched).toEqual([`file://${WAV_PATH}`]);
  });
});
