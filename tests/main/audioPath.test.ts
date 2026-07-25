// main/audioPath: 専用スキームで要求された wav パスの検証(信頼境界)。
// spec: changes/0007-runnable-popup-slice/spec.md「wav がある発動で音声も再生する」
// security-rules.md「入力と信頼境界」: renderer から来る URL をそのままファイル読み出しに使わない。
// 注: この検証関数はグルー(audioProtocol)から切り出した後付けの契約テスト(Red-first ではない)。

import { describe, it, expect } from "vitest";
import { AUDIO_SCHEME, resolveAudioRequest } from "../../src/main/audioPath.js";
import { resolveWavPath } from "../../src/agent/cheerPlayer.js";

const USER_DATA = "/home/u/.config/keycheer";

function urlFor(path: string): string {
  return `${AUDIO_SCHEME}://play/${encodeURIComponent(path)}`;
}

describe("audioPath / 許可される要求", () => {
  it("accepts a wav under userData (cheerPlayer が組み立てるパス)", () => {
    const wav = resolveWavPath(USER_DATA, "chia", "normal_regular_morning-000");
    expect(resolveAudioRequest(urlFor(wav), USER_DATA)).toBe(wav);
  });
});

describe("audioPath / 拒否される要求 [異常系]", () => {
  it("rejects paths outside userData (ディレクトリ外への読み出し)", () => {
    expect(resolveAudioRequest(urlFor("/etc/passwd.wav"), USER_DATA)).toBeNull();
  });

  it("rejects path traversal that escapes userData", () => {
    const escaped = `${USER_DATA}/characters/../../../../etc/secret.wav`;
    expect(resolveAudioRequest(urlFor(escaped), USER_DATA)).toBeNull();
  });

  it("rejects non-wav files even inside userData", () => {
    expect(resolveAudioRequest(urlFor(`${USER_DATA}/config.json`), USER_DATA)).toBeNull();
    expect(resolveAudioRequest(urlFor(`${USER_DATA}/audit.log.json`), USER_DATA)).toBeNull();
  });

  it("rejects an empty or malformed url", () => {
    expect(resolveAudioRequest(`${AUDIO_SCHEME}://play/`, USER_DATA)).toBeNull();
    expect(resolveAudioRequest("not a url", USER_DATA)).toBeNull();
  });
});
