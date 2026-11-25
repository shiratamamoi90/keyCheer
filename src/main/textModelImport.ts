// textModelImport: インストール中に、置いた GGUF を Ollama に取り込む(論点 0073)。
// 要件: docs/model-weights.md S0073_01〜05
//
// 取り込み先はアプリが使うのと同じ Ollama(:11434 に応答があればそれ、無ければ同梱の Ollama を起動する。起動と停止は bundledRuntime)。
// 取り込みは Ollama の HTTP API(論点 0030 決定 4):層を /api/blobs に送り、/api/create でテンプレートと stop をつけて名前を付ける。
// GGUF は置き場のファイルから送る。宛先は 127.0.0.1 の Ollama だけ(S0073_05。取得の通信はしない)。

import { createReadStream } from "node:fs";
import { TEXT_MODEL_FILE, TEXT_MODEL_OLLAMA } from "../core/shared/textModel.js";

export type TextModelImportResult =
  | { ok: true; isImported: boolean }
  | { ok: false; reason: "ollama-unavailable" | "import-failed" };

export async function importTextModel(input: {
  baseUrl: string;
  modelPath: string;
  sha256: string;
  fetchFn: typeof fetch;
  // 応答の無いときに同梱の Ollama を起動して応答を待つ / アプリが起動したものだけを止める(S0073_02)
  start: () => Promise<void>;
  stop: () => void;
}): Promise<TextModelImportResult> {
  const call = (path: string, init?: RequestInit): Promise<Response | null> =>
    input.fetchFn(`${input.baseUrl}${path}`, init).catch(() => null);
  try {
    await input.start();
    // S0073_04 時間内に応答しなければ失敗(起動したものは start の中で止めている)
    const version = await call("/api/version");
    if (version === null || !version.ok) return { ok: false, reason: "ollama-unavailable" };

    // S0073_03 同じ名前で同じ層のモデルがあれば取り込み直さない。層は Modelfile の FROM の blob の名前に出る
    const show = await call("/api/show", {
      method: "POST",
      body: JSON.stringify({ model: TEXT_MODEL_OLLAMA.name }),
    });
    if (show !== null && show.ok) {
      const { modelfile } = (await show.json()) as { modelfile?: unknown };
      if (typeof modelfile === "string" && modelfile.includes(`sha256-${input.sha256}`)) {
        return { ok: true, isImported: false };
      }
    }

    const digest = `sha256:${input.sha256}`;
    const head = await call(`/api/blobs/${digest}`, { method: "HEAD" });
    if (head === null || !head.ok) {
      const upload = await call(`/api/blobs/${digest}`, {
        method: "POST",
        body: createReadStream(input.modelPath) as unknown as BodyInit,
        duplex: "half",
      } as RequestInit);
      if (upload === null || !upload.ok) return { ok: false, reason: "import-failed" };
    }

    const create = await call("/api/create", {
      method: "POST",
      body: JSON.stringify({
        model: TEXT_MODEL_OLLAMA.name,
        files: { [TEXT_MODEL_FILE.file]: digest },
        template: TEXT_MODEL_OLLAMA.template,
        parameters: { stop: TEXT_MODEL_OLLAMA.stop },
        stream: false,
      }),
    });
    if (create === null || !create.ok) return { ok: false, reason: "import-failed" };
    return { ok: true, isImported: true };
  } finally {
    // S0073_01 / S0073_04 起動した Ollama は、成功でも失敗でも止める
    input.stop();
  }
}
