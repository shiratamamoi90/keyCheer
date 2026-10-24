// textResponse: テキスト応答のパース契約。純粋関数のみ。
// spec: 論点 0024 / docs/integrations.md「テキスト応答のパース契約」
//
// 3 実装(local-ollama / openai / anthropic)は応答を同じスキーマで返させ、ここで同じ規則に通す。
// 規則を各実装に持たせない — 以前は行頭記号の除去が 3 箇所に重複していた(論点 0024)。
// 応援発動経路からは import しない(プール生成時だけの処理。core/index.ts にも再エクスポートしない)。

// 1 文 = 30 文字以内(コードポイント基準。docs/data-model.md / docs/integrations.md 文字数契約)
export const MAX_MESSAGE_LENGTH = 30;

// 応答スキーマ。トップレベルをオブジェクトにするのは、OpenAI strict json_schema と
// Anthropic の tool 入力がオブジェクトを要求するため(論点 0024 理由)。
export const TEXT_RESPONSE_SCHEMA = {
  type: "object",
  properties: { messages: { type: "array", items: { type: "string" } } },
  required: ["messages"],
  additionalProperties: false,
} as const;

// S0024_10 形式違反はそのバケットの failed — ここは検出だけ。failed への落とし方は呼び出し側
export function validateTextResponse(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return ["text response is not an object"];
  const messages = (raw as Record<string, unknown>).messages;
  if (messages === undefined) return ["text response has no messages"];
  if (!Array.isArray(messages)) return ["text response messages is not an array"];
  if (!messages.every((m) => typeof m === "string")) {
    return ["text response messages contains a non-string element"];
  }
  return [];
}

const EMPHASIS = /\*\*|__/g;
const LEADING_HEADING = /^\s*#+\s+/;
const LEADING_BULLET = /^\s*(?:\d+[.)]\s*|[-*・]\s*)/;
// 半角・全角の丸括弧。括弧の中に括弧を含まないものだけを注記とみなす
const TRAILING_ANNOTATION = /\s*[(（][^()（）]*[)）]\s*$/;

// S0024_05 強調 / S0024_06 先頭の見出し記号と番号 / S0024_07 末尾の括弧注記
// S0024_11 文中の記号は残す — 見出し・番号は先頭だけ、注記は末尾だけに当てる。
// 単独の `*` を落とさないのは「3*3=9」のような本文を壊さないため。
function stripMarkers(text: string): string {
  return text
    .replace(EMPHASIS, "")
    .replace(LEADING_HEADING, "")
    .replace(LEADING_BULLET, "")
    .replace(TRAILING_ANNOTATION, "")
    .trim();
}

// S0024_04 配列の各要素を 1 文として返す(改行で分割し直さない)
// S0024_08 記号を落としてから文字数契約を当てる — 先に切ると `**` の分だけ本文が削られる
// S0024_09 空になった要素は数えない — 空を捨ててから N 件で打ち切る
// S0024_13 受け取った配列は変更しない(map / filter / slice は新しい配列を返す)
// 少ない分は切り上げない(空でなければバケットとして成立する。論点 0024 決定 5)。
export function buildMessageTexts(messages: readonly string[], maxCount: number): string[] {
  return messages
    .map(stripMarkers)
    .filter((text) => text.length > 0)
    .slice(0, maxCount)
    .map((text) => [...text].slice(0, MAX_MESSAGE_LENGTH).join(""));
}
