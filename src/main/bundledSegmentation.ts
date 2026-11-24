// bundledSegmentation: 同梱した u2netp(人物を切り抜くモデル)の置き場の解決と実行(論点 0063 / 0066)。
// 要件: docs/integrations.md「ローカル画像生成の作り方」S0063_01・S0066_01
//
// 実行ライブラリは npm の onnxruntime-node(CPU。論点 0066)。生成の画像の工程に入るまで読み込まない
// (ネイティブの DLL を、応援だけ使う起動で読ませないため)。発動経路からは import しない。

import {
  buildSegmentationInput,
  SEGMENTATION_INPUT_SIZE,
  type RgbaImage,
} from "../core/characterImage.js";

// 同梱物の中の置き場(scripts/fetch-u2netp.sh が同じ名前で置き、electron-builder が resources/ に入れる)
const SEGMENTATION_DIR_NAME = "u2netp";
const SEGMENTATION_MODEL_FILE = "u2netp.onnx";

export interface SegmentationSession {
  // 入力(1 x 3 x 320 x 320)を渡し、最初の出力(320 x 320)を返す
  run(input: Float32Array): Promise<Float32Array>;
}

export interface SegmentationRuntime {
  createSession(modelPath: string): Promise<SegmentationSession>;
}

// S0066_01 切り抜きのモデルは同梱したものだけを使う — パスは同梱物の置き場だけから決め、設定・入力・環境変数から受け取らない
export function resolveSegmentationModelPath(resourcesDir: string): string {
  return `${resourcesDir}/${SEGMENTATION_DIR_NAME}/${SEGMENTATION_MODEL_FILE}`;
}

// 絵(sd.cpp が出した PNG。縮小の前)を受け取り、モデルの最初の出力を返す関数を作る。
// セッションは最初に使うときに 1 回だけ作る(重みの読み込みに時間がかかるため、3 枚で使い回す)。
// 作れなければ毎回エラーにする — 呼び出し側が色で抜くやり方に戻す(S0063_04)
export function createPersonSegmenter(deps: {
  modelPath: string;
  runtime: SegmentationRuntime;
  decodeImage: (bytes: Uint8Array) => RgbaImage;
}): (bytes: Uint8Array) => Promise<Float32Array> {
  let session: Promise<SegmentationSession> | null = null;
  return async (bytes) => {
    session ??= deps.runtime.createSession(deps.modelPath);
    const input = buildSegmentationInput(deps.decodeImage(bytes));
    return (await session).run(input);
  };
}

interface OrtTensorLike {
  data: unknown;
}

interface OrtModuleLike {
  InferenceSession: {
    create(path: string): Promise<{
      inputNames: readonly string[];
      outputNames: readonly string[];
      run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
    }>;
  };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown;
}

// S0066_01 実行ライブラリは同梱した onnxruntime-node(CPU)だけ。実行の手段(execution provider)は既定の CPU のまま渡さない
export function createOnnxSegmentationRuntime(): SegmentationRuntime {
  return {
    async createSession(modelPath) {
      const loaded = (await import("onnxruntime-node")) as unknown as {
        default?: OrtModuleLike;
      } & OrtModuleLike;
      const ort = loaded.default ?? loaded;
      const session = await ort.InferenceSession.create(modelPath);
      return {
        async run(input) {
          const tensor = new ort.Tensor("float32", input, [
            1,
            3,
            SEGMENTATION_INPUT_SIZE,
            SEGMENTATION_INPUT_SIZE,
          ]);
          const outputs = await session.run({ [session.inputNames[0]!]: tensor });
          // 最初の出力がいちばん細かい予測(rembg も最初の出力を使う)
          const data = outputs[session.outputNames[0]!]?.data;
          if (!(data instanceof Float32Array)) throw new Error("u2netp returned no float output");
          return data;
        },
      };
    },
  };
}
