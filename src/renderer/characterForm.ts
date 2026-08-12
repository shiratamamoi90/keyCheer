// characterForm: キャラ作成フォームのビューモデル(純粋関数)。
// spec: 論点 0019
//   「必須項目が揃うまで保存できない」「名前と性格の長さ制約 [境界]」
//   「前後の空白は無視する [境界]」「話者を選ばないと保存できない」
//
// DOM 操作・IPC 送信は mainEntry 側の I/O グルー。ここは検証と値の組み立てだけを持つ。
// core 実装 / providers / agent は import しない(renderer は「使う側」に留める)。

// [要確認] 確定値(2026-07-26):名前 20 文字 / 性格 200 文字。コードポイント単位で数える。
export const CHARACTER_NAME_MAX = 20;
export const CHARACTER_PERSONALITY_MAX = 200;

export interface CharacterFormInput {
  name: string;
  personality: string;
  speakerId: number | null;
}

export type CharacterFormError =
  | { field: "name"; reason: "required" | "too-long" }
  | { field: "personality"; reason: "required" | "too-long" }
  | { field: "speakerId"; reason: "required" };

export interface CharacterFormValidation {
  ok: boolean;
  errors: CharacterFormError[];
}

// 保存対象のプロフィール(Character のうちこの論点 が書き込む部分)
export interface CharacterProfileDraft {
  name: string;
  personality: string;
  voicevoxSpeakerId: number;
}

// コードポイント単位で数える(絵文字・サロゲートペアで上限が半分にならないように)
function codePointLength(value: string): number {
  return [...value].length;
}

function validateText(value: string, max: number): { reason: "required" | "too-long" } | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { reason: "required" };
  if (codePointLength(trimmed) > max) return { reason: "too-long" };
  return undefined;
}

export function validateCharacterForm(input: CharacterFormInput): CharacterFormValidation {
  const errors: CharacterFormError[] = [];

  const name = validateText(input.name, CHARACTER_NAME_MAX);
  if (name !== undefined) errors.push({ field: "name", reason: name.reason });

  const personality = validateText(input.personality, CHARACTER_PERSONALITY_MAX);
  if (personality !== undefined) errors.push({ field: "personality", reason: personality.reason });

  if (input.speakerId === null) errors.push({ field: "speakerId", reason: "required" });

  return { ok: errors.length === 0, errors };
}

// 検証を通った入力のみ渡すこと(通っていない場合の値は保証しない)。
export function toCharacterProfile(input: CharacterFormInput): CharacterProfileDraft {
  return {
    name: input.name.trim(),
    personality: input.personality.trim(),
    voicevoxSpeakerId: input.speakerId ?? 0,
  };
}
