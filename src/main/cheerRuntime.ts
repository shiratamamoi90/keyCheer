// cheerRuntime: 発動経路の main 側グルー。1 押下 = engine.onKeyPress を回し、
// 発動時に wav パスを解決してポップアップへ IPC 送信し、cheerHistory を記録する。
// キー数・アクティブ時間はメモリ上に貯め、flushStats() でまとめて永続化する。
//
// ★ 発動経路の不変条件(cheer-trigger.md / CLAUDE.md):
//   ここは providers 設定・プロバイダー実装・生成系(poolGenerator/voiceSynth/providerRouter)を import しない。
//   外部送信は一切発生しない(localhost 含む)。成立要件はプール + 保存済み wav のみ。
//   engine(決定的)と agent の cheerPlayer(wav パス解決のみ、providers 非依存)だけに依存する。
//
// 時刻・乱数・プールは注入する(engine の純粋性を保つため、非決定性の注入点は main に閉じる)。

import {
  onKeyPress,
  initialRuntimeState,
  initialKeyCounterState,
  type RuntimeState,
  type MessagePool,
} from "../engine/index.js";
import { planCheerPlayback } from "../agent/cheerPlayer.js";
import { baselineMessages } from "../engine/baseline/messages.js";
import type { TriggerConfig, CheerHistoryEntry } from "../shared/types.js";
import type { CheerFiredPayload } from "../shared/ipc.js";

// 1 回の flush で永続化する単位(specs/key-counter.md「メモリ上で加算し、定期的にディスクへ保存する」)
export interface StatsDelta {
  day: string; // ローカル日付 "YYYY-MM-DD"
  keys: number;
  activeSeconds: number; // 秒未満の端数は次の flush へ繰り越す(累計がずれないように)
}

export interface CheerRuntimeDeps {
  userDataDir: string;
  popupDurationMs: number;
  // 発動時にポップアップへ渡す(renderer が wav 再生・表示を担う)
  emitCheer: (payload: CheerFiredPayload) => void;
  // cheerHistory への追記(store 経由)
  recordHistory: (entry: CheerHistoryEntry) => void;
  // wav 実在チェック(fs は main 側で注入。engine/発動経路は fs に触れない)
  wavExists: (path: string) => boolean;
  // 統計のまとめ書き(flushStats から日付ごとに 1 回ずつ呼ばれる)
  recordStats?: (delta: StatsDelta) => void;
  random?: () => number; // 既定 Math.random(テスト時に固定シード注入可)
}

export interface CheerRuntimeOptions {
  // 前回終了時までの累計キー数。発動判定は「累計カウント」で行う(specs/cheer-trigger.md)ため、
  // 起動時に永続化済みの totalKeyCount を渡してカウンタを継続させる。
  initialCount?: number;
}

export interface CheerRuntime {
  handleKeyPress(now: number): void;
  setConfig(config: TriggerConfig): void;
  setActiveCharacter(characterId: string | null, pool: MessagePool | null): void;
  // 貯めたキー数・アクティブ時間を永続化する(定期実行 + 終了前に呼ぶ)
  flushStats(): void;
}

// ローカル暦日のキー("YYYY-MM-DD")。UTC で切ると JST では 09:00 に「当日」が変わり、
// timeOfDay(ローカル時)と基準が食い違うためローカル日付で揃える。
function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  // 未永続化の統計。日付をまたぐ可能性があるのでローカル日付ごとに貯める。
  const pending = new Map<string, { keys: number; activeMs: number }>();

  return {
    setConfig(next) {
      config = next; // 設定変更の即時反映(次の押下から有効。RuntimeState は保持)
    },

    setActiveCharacter(id, nextPool) {
      characterId = id;
      pool = nextPool;
    },

    flushStats() {
      for (const [day, buffered] of pending) {
        const activeSeconds = Math.floor(buffered.activeMs / 1000);
        if (buffered.keys > 0 || activeSeconds > 0) {
          deps.recordStats?.({ day, keys: buffered.keys, activeSeconds });
        }
        // 秒未満の端数だけを残して繰り越す(切り捨て続けると累計が目減りする)
        buffered.keys = 0;
        buffered.activeMs -= activeSeconds * 1000;
      }
    },

    handleKeyPress(now) {
      const before = state.counter.activeMs;
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

      // シナリオ: キー押下でカウント加算 / アクティブ秒数の累積
      // ディスクには書かずメモリに貯める(specs/key-counter.md 不変条件)。
      const day = localDayKey(new Date(now));
      const bucket = pending.get(day) ?? { keys: 0, activeMs: 0 };
      bucket.keys += 1;
      bucket.activeMs += state.counter.activeMs - before;
      pending.set(day, bucket);

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
      });

      // シナリオ: 履歴の記録(cheer-trigger.md)。入力内容は含めない。
      deps.recordHistory({
        timestamp: new Date(now).toISOString(),
        count: cheer.count,
        kpm: cheer.kpm,
        speedZone: cheer.speedZone,
        type: cheer.type,
        timeOfDay: cheer.timeOfDay,
        messageId: cheer.messageId,
        message: cheer.message,
      });
    },
  };
}
