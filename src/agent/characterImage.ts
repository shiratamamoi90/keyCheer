// characterImage: キャラ画像 3 枚(待機画像・regular・milestone)を作るオーケストレーション。
// spec: 論点 0036 / docs/integrations.md「画像」「画像タグの要求」
//
// 画像 1 枚ごとに、テキストプロバイダーへ画像タグを要求 → 同じシードで画像プロバイダーへ 1 枚要求 → 書き出し。
// プロバイダーと書き出し先は注入する(実 HTTP・子プロセス・ファイルはテストで起こさない)。
// 1 枚の失敗は握り潰さず failed に数え、残りの画像は続ける(生成全体の成否は呼び出し側が決める)。
// 自動で別プロバイダーへ切り替えない・自動リトライしない(S0016_06 / C6)。

import {
  buildImageTagPrompt,
  buildImageTagText,
  CHARACTER_IMAGE_KINDS,
  validateImageTagResponse,
  type CharacterImageKind,
  type ImageTagCharacter,
} from "../core/characterImage.js";
import type { MessagePool } from "../core/messagePool.js";
import type { ImageGenerator, ImageTagGenerator } from "../core/providers/types.js";

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
