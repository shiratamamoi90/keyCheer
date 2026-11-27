// cheerRuntime: 発動経路の main 側グルー。1 押下 = core.onKeyPress を回し、
// 発動時に wav パスを解決してポップアップへ IPC 送信する。
// 保存するのは応援の発動に要る累計カウントだけ(論点 0080 / 0081)。応援ごとの記録・日ごとの記録・
// アクティブ時間は持たない。キー数はメモリ上に貯め、flushStats() でまとめて永続化する。
//
// ★ 発動経路の不変条件(cheer-trigger.md / CLAUDE.md):
//   ここはプロバイダー実装・生成系(poolGenerator/voiceSynth)を import しない。
//   外部送信は一切発生しない(localhost 含む)。成立要件はプール + 保存済み wav のみ。
//   core(決定的)と agent の cheerPlayer(wav パス解決のみ、providers 非依存)だけに依存する。
//
// 時刻・乱数・プールは注入する(core の純粋性を保つため、非決定性の注入点は main に閉じる)。

import {
  onKeyPress,
  initialRuntimeState,
  initialKeyCounterState,
  type RuntimeState,
  type MessagePool,
} from "../core/index.js";
import { planCheerPlayback, resolveImagePath } from "../agent/cheerPlayer.js";
import { baselineMessages } from "../core/baseline/messages.js";
import type { TriggerConfig } from "../core/shared/types.js";
import type { CheerFiredPayload } from "../core/shared/ipc.js";

export interface CheerRuntimeDeps {
  userDataDir: string;
  popupDurationMs: number;
  // 発動時にポップアップへ渡す(renderer が wav 再生・表示を担う)
  emitCheer: (payload: CheerFiredPayload) => void;
  // wav 実在チェック(fs は main 側で注入。core/発動経路は fs に触れない)
  wavExists: (path: string) => boolean;
  // 累計カウントのまとめ書き(docs/key-counter.md「メモリ上で加算し、定期的にディスクへ保存する」)。
  // flushStats が前回からのキー数を渡す。0 なら呼ばない
  recordKeyCount?: (keys: number) => void;
  random?: () => number; // 既定 Math.random(テスト時に固定シード注入可)
  // キャラ画像の実在チェック(論点 0036)。省略時は画像を渡さない
  imageExists?: (path: string) => boolean;
  // 使用中のキャラクターが変わったら待機画像を窓へ渡す(S0036_23)。画像が無ければ null
  emitCharacterDisplay?: (display: { idleImagePath: string | null }) => void;
}

export interface CheerRuntimeOptions {
  // 前回終了時までの累計キー数。発動判定は「累計カウント」で行う(docs/cheer-trigger.md)ため、
  // 起動時に永続化済みの totalKeyCount を渡してカウンタを継続させる。
  initialCount?: number;
}

export interface CheerRuntime {
  handleKeyPress(now: number): void;
  setConfig(config: TriggerConfig): void;
  setActiveCharacter(characterId: string | null, pool: MessagePool | null): void;
  // 貯めたキー数を永続化する(定期実行 + 終了前に呼ぶ)
  flushStats(): void;
}

export function createCheerRuntime(
  deps: CheerRuntimeDeps,
  initialConfig: TriggerConfig,
  options: CheerRuntimeOptions = {},
): CheerRuntime {
  const random = deps.random ?? Math.random;
  let state: RuntimeState = {
    ...initialRuntimeState,
    counter: { ...initialKeyCounterState, count: options.initialCount ?? 0 },
  };
  let config: TriggerConfig = initialConfig;
  let characterId: string | null = null;
  let pool: MessagePool | null = null;
  // 未永続化のキー数
  let pendingKeys = 0;

  // 保存済みのキャラ画像だけを渡す。発動で画像を作らない(S0036_26)— 無ければ null
  const existingImage = (kind: "idle" | "regular" | "milestone"): string | null => {
    if (characterId === null || deps.imageExists === undefined) return null;
    const path = resolveImagePath(deps.userDataDir, characterId, kind);
    return deps.imageExists(path) ? path : null;
  };

  return {
    setConfig(next) {
      config = next; // 設定変更の即時反映(次の押下から有効。RuntimeState は保持)
    },

    setActiveCharacter(id, nextPool) {
      characterId = id;
      pool = nextPool;
      // S0036_23 使用中のキャラクターを切り替えたら待機画像も切り替わる(プールが無くても待機画像は出す)
      deps.emitCharacterDisplay?.({ idleImagePath: existingImage("idle") });
    },

    flushStats() {
      if (pendingKeys === 0) return;
      deps.recordKeyCount?.(pendingKeys);
      pendingKeys = 0;
    },

    handleKeyPress(now) {
      const result = onKeyPress({
        state,
        now,
        hour: new Date(now).getHours(), // ローカル時。外部送信しない
        config,
        pool,
        baseline: baselineMessages,
        random,
      });
      state = result.state;

      // シナリオ: キー押下でカウント加算
      // ディスクには書かずメモリに貯める(docs/key-counter.md 不変条件)。
      pendingKeys += 1;

      const cheer = result.cheer;
      if (cheer === null) return;

      // wav パス解決は cheerPlayer(発動経路の唯一の規約)に委譲する。
      // baseline 定型文は事前合成 wav を持たず、プール文でも欠損時はテキストのみへ落ちる。
      const plan = planCheerPlayback({
        selection: { source: cheer.source, messageId: cheer.messageId, text: cheer.message },
        userDataDir: deps.userDataDir,
        characterId: characterId ?? "",
        // キャラ未設定なら wav は解決できない(常にテキストのみ)
        wavExists: (path) => characterId !== null && deps.wavExists(path),
      });

      deps.emitCheer({
        count: cheer.count,
        kpm: cheer.kpm,
        speedZone: cheer.speedZone,
        timeOfDay: cheer.timeOfDay,
        type: cheer.type,
        messageId: cheer.messageId,
        message: plan.popupText,
        wavPath: plan.wavPath,
        popupDurationMs: deps.popupDurationMs,
        // S0036_19 その応援種別の画像。S0036_22 定型文の応援では渡さない(renderer は待機画像を出す)
        imagePath: cheer.source === "pool" ? existingImage(cheer.type) : null,
      });
    },
  };
}
