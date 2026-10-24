// textResponseGuard: 3 実装に共通する「応答を応答スキーマとして読み、違反なら throw」。
// spec: 論点 0024 / docs/integrations.md「テキスト応答のパース契約」S0024_10
//
// throw にするのは、poolGenerator の既存の catch がそのバケットを failed にするため
// (失敗の落とし方を 1 箇所に保つ)。3 実装ともスキーマ準拠を保証する手段で要求しているので、
// 違反は打ち切り等の異常であり、行分割に退避しない(論点 0024 決定 3)。
// 記号の除去・件数・文字数は poolGenerator が core の buildMessageTexts で当てる。ここは形だけ。

import { validateTextResponse } from "../../core/textResponse.js";

// Ollama `response` / OpenAI `content` は JSON 文字列、Anthropic `tool_use.input` は解析済み
export function requireTextResponseMessages(raw: unknown, provider: string): string[] {
  let payload = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`${provider}: text response is not valid JSON`);
    }
  }
  const errors = validateTextResponse(payload);
  if (errors.length > 0) throw new Error(`${provider}: ${errors.join("; ")}`);
  return (payload as { messages: string[] }).messages;
}
