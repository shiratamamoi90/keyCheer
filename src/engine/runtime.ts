// runtime: 1 キー押下ごとの決定的処理を 1 関数に合成する発動経路の中核。
// カウント → アクティブ → KPM → 速度ゾーン → トリガー判定 → 応援選択 → 連続回避の記録。
// spec: specs/key-counter.md / speed-zone.md / cheer-trigger.md(各シナリオの合成)
// 純粋関数。外部依存ゼロ(providers・fetch・fs・electron に触れない)。時刻・乱数・プールは引数で受ける。

import { recordKeyPress, initialKeyCounterState, type KeyCounterState } from "./keyCounter.js";
import { computeKpm, classifyZone, pruneTimestamps } from "./speedZone.js";
import { shouldFire } from "./trigger.js";
import { classifyTimeOfDay } from "./timeOfDay.js";
import { selectCheer, type SelectionSource } from "./cheerSelector.js";
import type { BucketKey, MessagePool } from "./messagePool.js";
import type { BaselineKey } from "./baseline/messages.js";
import type { SpeedZone, CheerType, TimeOfDay, TriggerConfig } from "../shared/types.js";

export interface RuntimeState {
  counter: KeyCounterState;
  recentKeyTimestamps: number[]; // KPM 60 秒窓用。onKeyPress のたびに剪定される
  lastMessageIdByBucket: Record<string, string>; // 連続回避(セッション内除外)
}

export const initialRuntimeState: RuntimeState = {
  counter: initialKeyCounterState,
  recentKeyTimestamps: [],
  lastMessageIdByBucket: {},
};

// 発動時に確定する情報(main が stats.cheerHistory 記録・ポップアップ・wav 再生に使う)
export interface CheerEvent {
  count: number;
  kpm: number;
  speedZone: SpeedZone;
  timeOfDay: TimeOfDay;
  type: CheerType;
  messageId: string;
  message: string; // {milestone} 補間後の表示テキスト
  sourceBucketKey: BucketKey; // 連続回避の記録キー(0006)
  // 選択の由来。baseline は wav を事前合成していない — 呼び出し側が messageId を
  // 文字列パースして判定しなくて済むよう、engine が確定した値をそのまま渡す。
  source: SelectionSource;
}

export interface OnKeyPressInput {
  state: RuntimeState;
  now: number; // ms since epoch
  hour: number; // ローカル時(0..23)。呼び出し側が date.getHours() を渡す
  config: TriggerConfig;
  pool: MessagePool | null;
  baseline: Record<BaselineKey, string[]>;
  random: () => number;
}

export interface OnKeyPressResult {
  state: RuntimeState;
  cheer: CheerEvent | null;
}

export function onKeyPress(input: OnKeyPressInput): OnKeyPressResult {
  const { state, now, hour, config, pool, baseline, random } = input;

  const counter = recordKeyPress(state.counter, now, config.activeThresholdSec);
  const recentKeyTimestamps = pruneTimestamps([...state.recentKeyTimestamps, now], now);
  const kpm = computeKpm(recentKeyTimestamps, now);
  const speedZone = classifyZone(kpm);

  const nextState: RuntimeState = {
    counter,
    recentKeyTimestamps,
    lastMessageIdByBucket: state.lastMessageIdByBucket,
  };

  const type = shouldFire(counter.count, config);
  if (type === null) {
    return { state: nextState, cheer: null };
  }

  const timeOfDay = classifyTimeOfDay(hour);
  const selection = selectCheer({
    pool,
    zone: speedZone,
    type,
    timeOfDay,
    ...(type === "milestone" ? { milestone: counter.count } : {}),
    lastMessageIdByBucket: state.lastMessageIdByBucket,
    baseline,
    random,
  });

  // 連続回避は選択元バケット基準で記録する(0006)
  const lastMessageIdByBucket = {
    ...state.lastMessageIdByBucket,
    [selection.sourceBucketKey]: selection.messageId,
  };

  return {
    state: { ...nextState, lastMessageIdByBucket },
    cheer: {
      count: counter.count,
      kpm,
      speedZone,
      timeOfDay,
      type,
      messageId: selection.messageId,
      message: selection.text,
      sourceBucketKey: selection.sourceBucketKey,
      source: selection.source,
    },
  };
}
