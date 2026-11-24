// main/bundledSegmentation: 同梱した u2netp の置き場の解決と、人物を切り抜くモデルの実行(論点 0063 / 0066)。
// 要件: docs/integrations.md「ローカル画像生成の作り方」
// ONNX の実行ライブラリと画像の読み込みは注入する(実物の onnxruntime も Electron も動かさない)。

import { describe, it, expect, afterEach } from "vitest";
import {
  createPersonSegmenter,
  resolveSegmentationModelPath,
  type SegmentationRuntime,
} from "../../src/main/bundledSegmentation.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function fakeRuntime() {
  const createdPaths: string[] = [];
  const runtime: SegmentationRuntime = {
    createSession: async (path) => {
      createdPaths.push(path);
      return {
        run: async (input) => new Float32Array(input.length / 3).fill(0.5),
      };
    },
  };
  return { runtime, createdPaths };
}

describe("bundledSegmentation / 切り抜きのモデルと実行ライブラリは同梱したものだけを使う [否定]", () => {
  it("S0066_01 reads only the bundled u2netp even when settings and the environment name other paths", async () => {
    // GIVEN 環境変数と設定に、切り抜きのモデルのパスに見える値がある
    process.env.KEYCHEER_SEG_EVAL_DIR = "/home/someone/.cache/keycheer-models/seg-eval";
    process.env.U2NETP_PATH = "/tmp/evil/u2netp.onnx";
    const settings = { segmentationModelPath: "/tmp/evil/u2netp.onnx" };
    const { runtime, createdPaths } = fakeRuntime();

    // WHEN 人物を切り抜く
    const modelPath = resolveSegmentationModelPath("/app/resources");
    const segment = createPersonSegmenter({
      modelPath,
      runtime,
      decodeImage: () => ({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 255]) }),
    });
    await segment(new Uint8Array([1]));

    // THEN アプリ本体に同梱した u2netp だけを読む(ほかの置き場は読まない)
    expect(modelPath).toBe("/app/resources/u2netp/u2netp.onnx");
    expect(createdPaths).toEqual(["/app/resources/u2netp/u2netp.onnx"]);
    expect(createdPaths).not.toContain(settings.segmentationModelPath);
  });
});
