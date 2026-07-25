// audioPath: 専用スキームで要求された wav パスを検証する純粋関数(electron に依存しない)。
// spec: changes/0007-runnable-popup-slice/spec.md「wav がある発動で音声も再生する」(確定事項 #4)
// 信頼境界の検証(security-rules.md「入力と信頼境界」): renderer から来る URL をそのまま
// ファイル読み出しに使わず、{userData} 配下の .wav だけに限定する。

import { normalize, resolve, sep } from "node:path";

export const AUDIO_SCHEME = "keycheer-audio";

function isInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

// 許可なら絶対パス、拒否なら null を返す。
export function resolveAudioRequest(url: string, userDataDir: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (pathname.length === 0) return null;
  const candidate = normalize(pathname);
  if (!candidate.toLowerCase().endsWith(".wav")) return null;
  if (!isInside(userDataDir, candidate)) return null;
  return candidate;
}
