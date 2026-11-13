// characterImage: キャラ画像 3 枚(待機画像・regular・milestone)を作るオーケストレーション。
// spec: 論点 0036 / docs/integrations.md「画像」「画像タグの要求」
//
// 画像 1 枚ごとに、テキストプロバイダーへ画像タグを要求 → 同じシードで画像プロバイダーへ 1 枚要求 → 書き出し。
// プロバイダーと書き出し先は注入する(実 HTTP・子プロセス・ファイルはテストで起こさない)。
// 1 枚の失敗は握り潰さず failed に数え、残りの画像は続ける(生成全体の成否は呼び出し側が決める)。
// 自動で別プロバイダーへ切り替えない・自動リトライしない(S0016_06 / C6)。
//
// local-sdcpp だけは作り方が違う(論点 0045 / 0046。docs/integrations.md「ローカル画像生成の作り方」):
// 待機画像を白の下地から描き、応援種別の画像は待機画像を下絵に描き直す。保存の前に縮小し、背景を透明にして色を減らす。

import {
  applyBackgroundRemoval,
  applyImagePalette,
  buildImageTagPrompt,
  buildImageTagText,
  buildLocalImagePrompt,
  CHARACTER_IMAGE_KINDS,
  computeImagePalette,
  LOCAL_DERIVED_STEPS,
  LOCAL_DERIVED_STRENGTH,
  LOCAL_IDLE_STEPS,
  LOCAL_IDLE_STRENGTH,
  validateImageTagResponse,
  type CharacterImageKind,
  type ImageColor,
  type ImageTagCharacter,
  type RgbaImage,
} from "../core/characterImage.js";
import type { MessagePool } from "../core/messagePool.js";
import type { ImageGenerator, ImageTagGenerator } from "../core/providers/types.js";

// 応援種別の画像を作るのに要る、待機画像の情報。中断して再開するまでの間だけ残す(S0046_17〜19)。
// bytes = sd.cpp が出した待機画像(縮小・後処理の前)、tags = 待機画像の画像タグ、palette = 保存した待機画像の色
export interface LocalIdleSource {
  bytes: Uint8Array;
  tags: string;
  palette: ImageColor[];
}

// local-sdcpp の作り方に要る I/O。画素の読み書き(Electron の nativeImage)と保存は main が渡す
export interface LocalImageProcess {
  makeCanvas(width: number, height: number): Uint8Array; // 白で塗りつぶした下地の PNG
  decodeScaled(bytes: Uint8Array): RgbaImage; // 縮小(S0036_15)して画素の並びにする
  encodePng(image: RgbaImage): Uint8Array;
  loadIdleSource(): LocalIdleSource | null;
  saveIdleSource(source: LocalIdleSource): void;
}

export interface GenerateCharacterImagesInput {
  character: ImageTagCharacter;
  pool: MessagePool;
  tagGenerator: ImageTagGenerator;
  imageGenerator: ImageGenerator;
  seed: number;
  width: number;
  height: number;
  timeoutMsPerImage: number;
  // 作る画像(再開時は保存済みを除いて渡す)。省略時は 3 枚すべて
  kinds?: readonly CharacterImageKind[];
  // local-sdcpp の作り方に要る I/O。imageGenerator が local-sdcpp のときだけ使う(S0046_16)
  local?: LocalImageProcess;
  writeImage: (kind: CharacterImageKind, bytes: Uint8Array) => void | Promise<void>;
  shouldCancel?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface CharacterImagesResult {
  saved: CharacterImageKind[];
  failed: CharacterImageKind[];
  cancelled: boolean;
}

export async function generateCharacterImages(
  input: GenerateCharacterImagesInput,
): Promise<CharacterImagesResult> {
  const kinds = input.kinds ?? CHARACTER_IMAGE_KINDS;
  // S0046_16 外部の画像プロバイダーにはローカルの作り方を当てない
  if (input.local !== undefined && input.imageGenerator.id === "local-sdcpp") {
    return generateLocalImages(input, input.local, kinds);
  }
  const saved: CharacterImageKind[] = [];
  const failed: CharacterImageKind[] = [];

  for (const kind of kinds) {
    // 中断:残りの画像は saved にも failed にも入れない(再開で作る)
    if (input.shouldCancel?.()) return { saved, failed, cancelled: true };

    try {
      const raw = await input.tagGenerator.generateImageTags({
        prompt: buildImageTagPrompt(input.character, kind, input.pool),
        seed: input.seed,
        timeoutMs: input.timeoutMsPerImage,
      });
      if (validateImageTagResponse(raw).length > 0) {
        failed.push(kind);
      } else {
        // S0036_06 3 枚は同じシードで作る — 違うのはプロンプトの画像タグだけ
        const [bytes] = await input.imageGenerator.generateImages({
          prompt: buildImageTagText(raw),
          seed: input.seed,
          count: 1,
          width: input.width,
          height: input.height,
          timeoutMs: input.timeoutMsPerImage,
        });
        if (bytes === undefined) {
          failed.push(kind);
        } else {
          await input.writeImage(kind, bytes);
          saved.push(kind);
        }
      }
    } catch {
      failed.push(kind);
    }
    input.onProgress?.(saved.length + failed.length, kinds.length);
  }

  return { saved, failed, cancelled: false };
}

// 縮小 → 背景を透明に(S0046_09)。色を減らすのは呼び出し側(待機画像は自分の色、応援種別の画像は待機画像の色)
function decodeWithoutBackground(local: LocalImageProcess, bytes: Uint8Array): RgbaImage {
  return applyBackgroundRemoval(local.decodeScaled(bytes));
}

async function generateLocalImages(
  input: GenerateCharacterImagesInput,
  local: LocalImageProcess,
  requestedKinds: readonly CharacterImageKind[],
): Promise<CharacterImagesResult> {
  // 待機画像を必ず先に作る(ほかの 2 枚の下絵になる)
  const kinds = CHARACTER_IMAGE_KINDS.filter((kind) => requestedKinds.includes(kind));
  const saved: CharacterImageKind[] = [];
  const failed: CharacterImageKind[] = [];
  // 待機画像を作らない回(再開)は、残してある待機画像の情報を使う(S0046_17)
  let source = kinds.includes("idle") ? null : local.loadIdleSource();

  const requestTags = async (kind: CharacterImageKind): Promise<string | null> => {
    const raw = await input.tagGenerator.generateImageTags({
      prompt: buildImageTagPrompt(input.character, kind, input.pool),
      seed: input.seed,
      timeoutMs: input.timeoutMsPerImage,
    });
    return validateImageTagResponse(raw).length > 0 ? null : buildImageTagText(raw);
  };
  const requestImage = async (
    prompt: string,
    initImage: Uint8Array,
    strength: number,
    steps: number,
  ): Promise<Uint8Array | undefined> => {
    // S0046_05 どの画像も同じシード・同じ大きさで作る
    const [bytes] = await input.imageGenerator.generateImages({
      prompt,
      seed: input.seed,
      count: 1,
      width: input.width,
      height: input.height,
      timeoutMs: input.timeoutMsPerImage,
      initImage,
      strength,
      steps,
    });
    return bytes;
  };

  // S0046_06 待機画像は白の下地から描く。作れたら、応援種別の画像に要る情報を残してから保存する
  // (保存の直後に中断されても、再開で下絵に使えるようにするため)
  const makeIdle = async (): Promise<LocalIdleSource | null> => {
    const tags = await requestTags("idle");
    if (tags === null) return null;
    const bytes = await requestImage(
      buildLocalImagePrompt(tags),
      local.makeCanvas(input.width, input.height),
      LOCAL_IDLE_STRENGTH,
      LOCAL_IDLE_STEPS,
    );
    if (bytes === undefined) return null;
    const cut = decodeWithoutBackground(local, bytes);
    const palette = computeImagePalette(cut);
    const made = { bytes, tags, palette };
    local.saveIdleSource(made);
    await input.writeImage("idle", local.encodePng(applyImagePalette(cut, palette)));
    return made;
  };

  // S0046_07 応援種別の画像は待機画像を下絵に描く / S0046_13 待機画像の色だけで塗る
  const makeDerived = async (kind: CharacterImageKind, idle: LocalIdleSource): Promise<boolean> => {
    const tags = await requestTags(kind);
    if (tags === null) return false;
    const bytes = await requestImage(
      buildLocalImagePrompt(idle.tags, tags),
      idle.bytes,
      LOCAL_DERIVED_STRENGTH,
      LOCAL_DERIVED_STEPS,
    );
    if (bytes === undefined) return false;
    const cut = decodeWithoutBackground(local, bytes);
    await input.writeImage(kind, local.encodePng(applyImagePalette(cut, idle.palette)));
    return true;
  };

  for (const kind of kinds) {
    if (input.shouldCancel?.()) return { saved, failed, cancelled: true };

    if (kind === "idle") {
      try {
        source = await makeIdle();
      } catch {
        source = null;
      }
      if (source !== null) saved.push(kind);
    } else if (source !== null) {
      let isMade = false;
      try {
        isMade = await makeDerived(kind, source);
      } catch {
        isMade = false;
      }
      (isMade ? saved : failed).push(kind);
    }

    // S0046_08 待機画像を作れなければ応援種別の画像も作らない — 下絵が無いので、残りはすべて失敗にして終える
    if (source === null) {
      const rest = kinds.filter((k) => !saved.includes(k) && !failed.includes(k));
      failed.push(...rest);
      input.onProgress?.(saved.length + failed.length, kinds.length);
      return { saved, failed, cancelled: false };
    }
    input.onProgress?.(saved.length + failed.length, kinds.length);
  }

  return { saved, failed, cancelled: false };
}
