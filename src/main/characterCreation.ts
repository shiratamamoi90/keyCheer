// characterCreation: プール生成 → wav 合成 → キャラ画像 → 永続化のオーケストレーション。
// spec: 論点 0020 / 論点 0036(画像の工程)
//
// 生成の中身は agent 側(generatePool / synthesizePoolVoices)が持つ。ここは配線と
// 「いつ保存するか」「失敗をどう扱うか」だけを決める。
// プロバイダーと fs はすべて注入 — 実 HTTP も実ファイル書き込みもテストで起こさない。

import { generatePool, isPoolComplete, type PoolGenerationState } from "../agent/poolGenerator.js";
import { synthesizePoolVoices } from "../agent/voiceSynth.js";
import { generateCharacterImages } from "../agent/characterImage.js";
import { CHARACTER_IMAGE_KINDS, type CharacterImageKind } from "../core/characterImage.js";
import { resolveImagePath } from "../agent/cheerPlayer.js";
import { ALL_BUCKET_KEYS, type MessagePool, type PoolMessage } from "../core/messagePool.js";
import type {
  ImageGenerator,
  ImageTagGenerator,
  TextGenerator,
  VoiceSynthesizer,
} from "../core/providers/types.js";
import type { GeneratedBy } from "../core/shared/types.js";
import type { AppStore } from "./store.js";
import { loadActiveCharacterPool, type ActiveCharacterPoolDeps } from "./characterSelection.js";
import {
  savePool,
  createWavWriter,
  clearVoices,
  createImageWriter,
  clearImages,
  type CharacterFs,
} from "./characterStore.js";

export type GenerationPhase = "text" | "voice" | "image";

export interface GenerationProgress {
  phase: GenerationPhase;
  done: number;
  total: number;
}

export interface StartGenerationInput {
  characterId: string;
  character: { name: string; personality: string };
  userDataDir: string;
  fs: CharacterFs;
  textGenerator: TextGenerator;
  synthesizer: VoiceSynthesizer;
  speakerId?: number;
  resumeFrom?: PoolGenerationState;
  shouldCancel?: () => boolean;
  onProgress?: (progress: GenerationProgress) => void;
  timeoutMsPerBucket?: number;
  timeoutMsPerMessage?: number;
  // 画像の工程(論点 0036)。渡したときだけ画像を作る(画像プロバイダーを組み立てられないときは渡さない)
  image?: ImageGenerationInput;
}

export interface ImageGenerationInput {
  generator: ImageGenerator;
  tagGenerator: ImageTagGenerator;
  seed: number;
  width: number;
  height: number;
  timeoutMsPerImage?: number;
  // 縮小・PNG 化(S0036_15)。main が Electron の nativeImage を渡す。省略時は素通し
  encode?: (bytes: Uint8Array) => Uint8Array;
}

// images: 画像の工程を通したときだけ持つ。missing = 作れなかった画像(S0036_10 のエラー表示に使う)
export interface ImagesOutcome {
  saved: CharacterImageKind[];
  missing: CharacterImageKind[];
}

// completed: 欠損なく完了した種別と、実際に使ったプロバイダー ID(論点 0022)。
// 保存は呼び出し側(store.recordGeneratedBy)。runner は store を知らない。
// cleared: 作り直したが揃わなかった種別。前の記録も消す(S0036_17)
export type GenerationResult =
  | {
      ok: true;
      pool: MessagePool;
      synthesized: number;
      missing: number;
      completed: GeneratedBy;
      cleared?: (keyof GeneratedBy)[];
      images?: ImagesOutcome;
    }
  | {
      ok: false;
      reason: "text-generation-failed" | "cancelled" | "already-running";
      state?: PoolGenerationState;
      // already-running では生成を始めていないので持たない(記録の対象外)
      completed?: GeneratedBy;
      cleared?: (keyof GeneratedBy)[];
    };

export interface GenerationRunner {
  start(input: StartGenerationInput): Promise<GenerationResult>;
  isRunning(): boolean;
  cancel(): void;
}

const DEFAULT_TIMEOUT_MS_PER_MESSAGE = 30_000;
const DEFAULT_TIMEOUT_MS_PER_IMAGE = 120_000;

function allMessages(pool: MessagePool): PoolMessage[] {
  const messages: PoolMessage[] = [];
  for (const key of ALL_BUCKET_KEYS) {
    for (const message of pool.buckets[key]) messages.push(message);
  }
  return messages;
}

export function createGenerationRunner(): GenerationRunner {
  let running = false;
  let cancelled = false;

  return {
    isRunning: () => running,
    cancel: () => {
      cancelled = true;
    },

    async start(input: StartGenerationInput): Promise<GenerationResult> {
      // シナリオ: 生成中に再度生成を開始できない [境界]
      if (running) return { ok: false, reason: "already-running" };
      running = true;
      cancelled = false;

      try {
        const shouldCancel = (): boolean => cancelled || (input.shouldCancel?.() ?? false);

        // --- テキスト ---
        const state = await generatePool({
          characterId: input.characterId,
          character: input.character,
          generator: input.textGenerator,
          ...(input.resumeFrom !== undefined ? { resumeFrom: input.resumeFrom } : {}),
          ...(input.timeoutMsPerBucket !== undefined
            ? { timeoutMsPerBucket: input.timeoutMsPerBucket }
            : {}),
          shouldCancel,
          onProgress: (done, total) => input.onProgress?.({ phase: "text", done, total }),
        });

        // 部分結果は必ず残す(再開のため)。完成扱いにはしない。
        // 生成時のプロフィールも残す — 「生成後に変えた」の比べる元(論点 0032)。話者が無い呼び出しでは
        // 比べる元として不完全なので書かない(書かなければ「変えた」と判定しない = S0032_23)。
        savePool(
          input.fs,
          input.userDataDir,
          input.characterId,
          state,
          input.speakerId !== undefined
            ? { ...input.character, voicevoxSpeakerId: input.speakerId }
            : undefined,
        );

        if (!isPoolComplete(state)) {
          // シナリオ: 生成を中断して再開する / Ollama 未起動で生成を開始した [異常系]
          // 未完了のまま音声合成へ進まない(中途半端な wav を作らない)。
          return {
            ok: false,
            reason: shouldCancel() ? "cancelled" : "text-generation-failed",
            state,
            // S0022_07 全種別が失敗したら記録しない — テキストが揃わなければ音声にも進まない
            completed: {},
          };
        }

        // --- 音声 ---
        // シナリオ: 既にプールがある状態で再生成 — 古い wav を残さない
        clearVoices(input.fs, input.userDataDir, input.characterId);

        const messages = allMessages(state.pool);
        const { synthesized, missing } = await synthesizePoolVoices({
          messages,
          synthesizer: input.synthesizer,
          ...(input.speakerId !== undefined ? { speakerId: input.speakerId } : {}),
          timeoutMsPerMessage: input.timeoutMsPerMessage ?? DEFAULT_TIMEOUT_MS_PER_MESSAGE,
          writeWav: createWavWriter(input.fs, input.userDataDir, input.characterId),
          onProgress: (done, total) => input.onProgress?.({ phase: "voice", done, total }),
        });

        // シナリオ: VOICEVOX 未起動で音声だけ失敗した / 音声の部分失敗を許容する [境界]
        // wav が 1 本も取れなくてもプールは有効。応援はテキストのみで成立する。
        // S0022_01 テキスト生成の完了で text を記録 / S0022_02 音声合成の完了で voice を記録
        // S0022_03 欠損のある種別は記録しない — 1 本でも欠けたら voice は記録しない。
        // generatedBy は再生成時の参照用なので、欠損したまま「このプロバイダーで作った」と
        // 残すと同じ欠損を再現する余地が残る(論点 0022 理由)。
        // ID は選択値ではなく、実際に呼んだ生成器から取る(S0022_04)。
        const completed: GeneratedBy =
          missing.length === 0
            ? { text: input.textGenerator.id, voice: input.synthesizer.id }
            : { text: input.textGenerator.id };

        if (input.image === undefined) {
          return {
            ok: true,
            pool: state.pool,
            synthesized: synthesized.length,
            missing: missing.length,
            completed,
          };
        }

        // --- 画像(論点 0036) ---
        // S0036_12 再開(resumeFrom あり)では保存済みの画像を作り直さない。
        // S0036_13 再生成(resumeFrom なし)では前の画像を消してから作る — 前のプロフィールの絵を混ぜない。
        // S0036_11 テキストが揃わなければここに来ない(上で return 済み)。
        const image = input.image;
        if (input.resumeFrom === undefined) {
          clearImages(input.fs, input.userDataDir, input.characterId);
        }
        const isSaved = (kind: CharacterImageKind): boolean =>
          input.fs.exists(resolveImagePath(input.userDataDir, input.characterId, kind));
        const alreadySaved = CHARACTER_IMAGE_KINDS.filter(isSaved);
        const images = await generateCharacterImages({
          character: input.character,
          pool: state.pool,
          tagGenerator: image.tagGenerator,
          imageGenerator: image.generator,
          seed: image.seed,
          width: image.width,
          height: image.height,
          timeoutMsPerImage: image.timeoutMsPerImage ?? DEFAULT_TIMEOUT_MS_PER_IMAGE,
          kinds: CHARACTER_IMAGE_KINDS.filter((kind) => !isSaved(kind)),
          writeImage: createImageWriter(
            input.fs,
            input.userDataDir,
            input.characterId,
            image.encode,
          ),
          shouldCancel,
          // S0036_08 進捗に画像の工程が含まれる(保存済みの分も done に数える)
          onProgress: (done) =>
            input.onProgress?.({
              phase: "image",
              done: alreadySaved.length + done,
              total: CHARACTER_IMAGE_KINDS.length,
            }),
        });

        if (images.cancelled) {
          // 中断:テキスト・音声は揃っているので記録する。使用中は変えない(S0032_32)
          return { ok: false, reason: "cancelled", state, completed };
        }

        // S0036_09 / S0036_10 画像が一部・全部欠けても生成は完了とする(応援は画像なしでも成立する)
        // S0036_16 3 枚揃ったら image を記録 / S0036_17 欠けたら記録せず、前の記録も消す
        const saved = CHARACTER_IMAGE_KINDS.filter(isSaved);
        const isComplete = saved.length === CHARACTER_IMAGE_KINDS.length;
        return {
          ok: true,
          pool: state.pool,
          synthesized: synthesized.length,
          missing: missing.length,
          completed: isComplete ? { ...completed, image: image.generator.id } : completed,
          ...(isComplete ? {} : { cleared: ["image" as const] }),
          images: { saved, missing: CHARACTER_IMAGE_KINDS.filter((kind) => !isSaved(kind)) },
        };
      } finally {
        running = false;
      }
    },
  };
}

export interface GenerationResultDeps {
  store: Pick<
    AppStore,
    | "loadCharacters"
    | "loadActiveCharacterId"
    | "saveActiveCharacterId"
    | "recordGeneratedBy"
    | "loadGeneration"
  >;
  loadPool: ActiveCharacterPoolDeps["loadPool"];
  // 発動経路へプールを渡す(再起動なしで使わせる。S0020_10)
  onActiveCharacterChanged: (characterId: string, pool: MessagePool) => void;
}

// 生成結果の保存:生成元の記録(論点 0022)と、完了時の使用中の更新(論点 0032)。
// S0032_18 記録も使用中も、生成したキャラクターの id にだけ書く
export function saveGenerationResult(
  deps: GenerationResultDeps,
  characterId: string,
  result: GenerationResult,
): void {
  // 失敗時も completed を渡す — 空なら何も変わらない
  if (result.completed !== undefined) {
    deps.store.recordGeneratedBy(characterId, result.completed, result.cleared ?? []);
  }
  // S0032_32 中断・失敗した生成では使用中を変えない [否定]
  if (!result.ok) return;

  // S0032_19 生成が完了したらそのキャラクターを使用中にする
  // S0032_20 設定が「しない」なら変えない / S0032_21 ただし使用中が無ければ使用中にする
  // 使用中が無いまま生成を終えると、作ったばかりのキャラクターが使われず定型文のまま応援が続くため。
  const hasUsableActive = loadActiveCharacterPool(deps) !== null;
  if (deps.store.loadGeneration().shouldActivateOnComplete || !hasUsableActive) {
    deps.store.saveActiveCharacterId(characterId);
    deps.onActiveCharacterChanged(characterId, result.pool);
  }
}
