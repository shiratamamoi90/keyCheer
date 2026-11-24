// characterImage: キャラ画像 3 枚(待機画像・regular・milestone)を作るオーケストレーション。
// spec: 論点 0036 / docs/integrations.md「画像」「画像タグの要求」
//
// 画像 1 枚ごとに、テキストプロバイダーへ画像タグを要求 → 同じシードで画像プロバイダーへ 1 枚要求 → 書き出し。
// プロバイダーと書き出し先は注入する(実 HTTP・子プロセス・ファイルはテストで起こさない)。
// 1 枚の失敗は握り潰さず failed に数え、残りの画像は続ける(生成全体の成否は呼び出し側が決める)。
// 自動リトライしない(C6)。
//
// 作り方(論点 0045 / 0046。docs/integrations.md「ローカル画像生成の作り方」):待機画像を白の下地から描き、
// 応援種別の画像は待機画像を下絵に描き直す。保存の前に縮小し、背景を透明にして色を減らす。
// `local`(画素の読み書き)を渡さない呼び出しは、画像タグだけで 3 枚を作る単純な経路になる。
// 生成は local-sdcpp だけ(論点 0054)なので本番は必ず `local` を渡す。単純な経路は画像タグの要求の部品(S0036_01〜05)を縛るのに残す

import {
  applyBackgroundRemoval,
  applyImagePalette,
  applyPersonProbabilityMask,
  buildImageTagPrompt,
  buildImageTagText,
  buildLocalImagePrompt,
  buildLocalImageTagPrompt,
  CHARACTER_IMAGE_KINDS,
  computeImagePalette,
  computePersonProbability,
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
import type { CheerType } from "../core/shared/types.js";
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
  // 人物を切り抜くモデル(u2netp。論点 0063)に sd.cpp が出した絵(縮小の前)を渡し、最初の出力(320x320)を返す。
  // 渡さないとき・失敗したときは色で抜く(S0063_04)
  segmentPerson?: (bytes: Uint8Array) => Promise<Float32Array>;
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
  // ローカル画像生成の作り方に要る I/O
  local?: LocalImageProcess;
  writeImage: (kind: CharacterImageKind, bytes: Uint8Array) => void | Promise<void>;
  shouldCancel?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface CharacterImagesResult {
  saved: CharacterImageKind[];
  failed: CharacterImageKind[];
  cancelled: boolean;
  // 保存した画像に使った画像タグ(画像の生成記録に残す。論点 0050 S0050_08)
  tags: Partial<Record<CharacterImageKind, string>>;
}

export async function generateCharacterImages(
  input: GenerateCharacterImagesInput,
): Promise<CharacterImagesResult> {
  const kinds = input.kinds ?? CHARACTER_IMAGE_KINDS;
  if (input.local !== undefined) {
    return generateLocalImages(input, input.local, kinds);
  }
  const saved: CharacterImageKind[] = [];
  const failed: CharacterImageKind[] = [];
  const tags: Partial<Record<CharacterImageKind, string>> = {};

  const requestTags = async (kind: CharacterImageKind): Promise<string | null> => {
    const raw = await input.tagGenerator.generateImageTags({
      prompt: buildImageTagPrompt(input.character, kind, input.pool),
      seed: input.seed,
      timeoutMs: input.timeoutMsPerImage,
    });
    return validateImageTagResponse(raw).length > 0 ? null : buildImageTagText(raw);
  };

  for (const kind of kinds) {
    // 中断:残りの画像は saved にも failed にも入れない(再開で作る)
    if (input.shouldCancel?.()) return { saved, failed, cancelled: true, tags };

    try {
      const tagText = await requestTags(kind);
      if (tagText === null) {
        failed.push(kind);
      } else {
        const [bytes] = await input.imageGenerator.generateImages({
          prompt: tagText,
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
          tags[kind] = tagText;
        }
      }
    } catch {
      failed.push(kind);
    }
    input.onProgress?.(saved.length + failed.length, kinds.length);
  }

  return { saved, failed, cancelled: false, tags };
}

// 縮小 → 背景を透明に。色を減らすのは呼び出し側(待機画像は自分の色、応援種別の画像は待機画像の色)
// S0063_05 3 枚それぞれ、その絵自身から出した確率で切り抜く
// S0063_04 切り抜きに失敗したら色で抜くやり方(S0046_09)に戻す。重みや実行ライブラリが壊れていても、
// 画像なしにするより色で抜いた絵を残すほうがよい(論点 0063 の決定)
async function decodeWithoutBackground(
  local: LocalImageProcess,
  bytes: Uint8Array,
): Promise<RgbaImage> {
  const small = local.decodeScaled(bytes);
  if (local.segmentPerson !== undefined) {
    try {
      const output = await local.segmentPerson(bytes);
      return applyPersonProbabilityMask(
        small,
        computePersonProbability(output, small.width, small.height),
      );
    } catch {
      // 下の色で抜くやり方に戻す
    }
  }
  return applyBackgroundRemoval(small);
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
  const tags: Partial<Record<CharacterImageKind, string>> = {};
  // 待機画像を作らない回(再開)は、残してある待機画像の情報を使う(S0046_17)
  let source = kinds.includes("idle") ? null : local.loadIdleSource();
  if (source !== null) tags.idle = source.tags;

  const requestTags = async (kind: CharacterImageKind): Promise<string | null> => {
    // S0049_01 / S0062_05 待機画像は見た目を、応援種別の画像は表情だけを訊く
    const raw = await input.tagGenerator.generateImageTags({
      prompt: buildLocalImageTagPrompt(input.character, kind, input.pool),
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
    // S0065_01 どの画像も同じシード・同じ大きさで作る
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
    const cut = await decodeWithoutBackground(local, bytes);
    const palette = computeImagePalette(cut);
    const made = { bytes, tags, palette };
    local.saveIdleSource(made);
    await input.writeImage("idle", local.encodePng(applyImagePalette(cut, palette)));
    return made;
  };

  // S0046_07 応援種別の画像は待機画像を下絵に描く / S0046_13 待機画像の色だけで塗る
  const makeDerived = async (kind: CheerType, idle: LocalIdleSource): Promise<boolean> => {
    const kindTags = await requestTags(kind);
    if (kindTags === null) return false;
    const bytes = await requestImage(
      buildLocalImagePrompt(idle.tags, { kind, tags: kindTags }),
      idle.bytes,
      LOCAL_DERIVED_STRENGTH,
      LOCAL_DERIVED_STEPS,
    );
    if (bytes === undefined) return false;
    const cut = await decodeWithoutBackground(local, bytes);
    await input.writeImage(kind, local.encodePng(applyImagePalette(cut, idle.palette)));
    tags[kind] = kindTags;
    return true;
  };

  for (const kind of kinds) {
    if (input.shouldCancel?.()) return { saved, failed, cancelled: true, tags };

    if (kind === "idle") {
      try {
        source = await makeIdle();
      } catch {
        source = null;
      }
      if (source !== null) {
        saved.push(kind);
        tags.idle = source.tags;
      }
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
      return { saved, failed, cancelled: false, tags };
    }
    input.onProgress?.(saved.length + failed.length, kinds.length);
  }

  return { saved, failed, cancelled: false, tags };
}
