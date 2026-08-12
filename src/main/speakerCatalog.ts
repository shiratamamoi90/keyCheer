// speakerCatalog: VOICEVOX から話者一覧を取得する。
// spec: 論点 0019
//   「話者一覧を VOICEVOX から取得する」「VOICEVOX 未起動でも画面は壊れない [異常系]」
//   「話者一覧の取得は localhost に閉じる [不変条件]」
//
// VOICEVOX は話者ごとに styles の配列を返すため、選択肢として使える 1 次元に平坦化する。
// 未起動・異常応答・想定外の形はすべて unavailable に畳んで throw しない
// (フォームは開けたまま、案内を出して保存だけを止めるため)。

export const DEFAULT_VOICEVOX_ENDPOINT = "http://127.0.0.1:50021";

const DEFAULT_TIMEOUT_MS = 3_000;

export interface Speaker {
  id: number; // style ごとに一意。character.voicevoxSpeakerId に入る値
  name: string; // 話者名(例: ずんだもん)
  styleName: string; // スタイル名(例: あまあま)
}

export interface FetchSpeakersConfig {
  endpoint?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export type FetchSpeakersResult =
  | { ok: true; speakers: Speaker[] }
  | { ok: false; reason: "unavailable" };

interface RawStyle {
  name?: unknown;
  id?: unknown;
}

interface RawSpeaker {
  name?: unknown;
  styles?: unknown;
}

function parseSpeakers(payload: unknown): Speaker[] | undefined {
  if (!Array.isArray(payload)) return undefined;
  const speakers: Speaker[] = [];
  for (const entry of payload as RawSpeaker[]) {
    if (typeof entry?.name !== "string" || !Array.isArray(entry.styles)) return undefined;
    for (const style of entry.styles as RawStyle[]) {
      if (typeof style?.id !== "number" || typeof style.name !== "string") return undefined;
      speakers.push({ id: style.id, name: entry.name, styleName: style.name });
    }
  }
  return speakers;
}

export async function fetchSpeakers(
  config: FetchSpeakersConfig = {},
): Promise<FetchSpeakersResult> {
  const {
    endpoint = DEFAULT_VOICEVOX_ENDPOINT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = fetch,
  } = config;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${endpoint}/speakers`, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const speakers = parseSpeakers(await res.json());
    if (speakers === undefined) return { ok: false, reason: "unavailable" };
    return { ok: true, speakers };
  } catch {
    // 未起動(ECONNREFUSED)・タイムアウト・JSON 破損はすべて「使えない」に畳む
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
