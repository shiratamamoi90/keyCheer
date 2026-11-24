// characterImagesView: 作った画像 3 枚の並べ方と、「画像だけ作り直す」を使えるか(純粋関数。論点 0050)。
// 要件: docs/main-window.md S0050_01 / S0050_02 / S0050_03 / S0050_06 / S0050_07
// DOM 操作と IPC は mainEntry 側の I/O グルー。core 実装 / providers / agent は import しない。

import { buildImageUrl } from "../core/shared/ipc.js";
import type { GenerationViewState } from "./generationView.js";

export type ImageSlotKind = "idle" | "regular" | "milestone";

export interface ImageSlot {
  kind: ImageSlotKind;
  label: string;
  url: string | null; // null = 欠けている
}

const SLOTS: readonly { kind: ImageSlotKind; label: string }[] = [
  { kind: "idle", label: "ふだん" },
  { kind: "regular", label: "通常の応援" },
  { kind: "milestone", label: "節目の応援" },
];

// S0050_01 3 枚を並べる / S0050_03 欠けた画像は欠けていると分かるように示す — 待機画像で代えない
// (キャラの窓は代わりに待機画像を出す S0036_20 が、ここは抜けそこないや欠けに気づくための画面なので代えない)
export function buildImageSlots(images: Partial<Record<ImageSlotKind, string>>): ImageSlot[] {
  return SLOTS.map(({ kind, label }) => {
    const path = images[kind];
    return { kind, label, url: path === undefined ? null : buildImageUrl(path) };
  });
}

// S0050_02 生成が終わったら生成画面に 3 枚を出す(実行中は出さない — 途中の絵を完成と見せない)
export function canShowGeneratedImages(generation: GenerationViewState): boolean {
  return generation.phase === "done";
}

export interface ImageRegenerationAvailability {
  isEnabled: boolean;
  notice: string | null;
}

// S0050_06 重みがあり、何も実行していなければ使える / S0050_07 使えないときは理由を示す
export function resolveImageRegeneration(input: {
  canMakeImages: boolean;
  isRunning: boolean;
}): ImageRegenerationAvailability {
  if (!input.canMakeImages) {
    return {
      isEnabled: false,
      notice: "画像生成のモデルの重みがありません。インストーラで入れ直してください",
    };
  }
  if (input.isRunning) return { isEnabled: false, notice: "生成中です。終わってから作り直せます" };
  return { isEnabled: true, notice: null };
}
