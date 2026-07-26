// characterInput: renderer から届いたキャラ保存リクエストの検証。
// spec: specs/character-creation.md「renderer からの入力は main 側でも検証する [不変条件]」
//
// 信頼境界:フォーム側(renderer/characterForm.ts)の検証は UX のためのもので、
// main 側の検証を省く理由にはならない(security-rules.md「入力と信頼境界」)。
// electron を import しないため決定的にテストできる。

export interface ValidatedCharacterProfile {
  name: string;
  personality: string;
  voicevoxSpeakerId: number;
}

export type ValidateCharacterProfileResult =
  | { ok: true; value: ValidatedCharacterProfile }
  | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCharacterProfile(raw: unknown): ValidateCharacterProfileResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["payload must be an object"] };
  }

  const errors: string[] = [];
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const personality = typeof raw.personality === "string" ? raw.personality.trim() : "";
  const speakerId = raw.voicevoxSpeakerId;

  if (name.length === 0) errors.push("name is required");
  if (personality.length === 0) errors.push("personality is required");
  if (typeof speakerId !== "number" || !Number.isInteger(speakerId)) {
    errors.push("voicevoxSpeakerId must be an integer");
  }
  if (errors.length > 0) return { ok: false, errors };

  // 既知の 3 フィールドだけを取り出す。imagePaths / pool 等を renderer から注入させない。
  return { ok: true, value: { name, personality, voicevoxSpeakerId: speakerId as number } };
}
