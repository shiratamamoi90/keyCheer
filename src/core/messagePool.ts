// messagePool: バケットキー解決とプール構造の契約。純粋関数のみ。
// 要件: docs/data-model.md / docs/cheer-trigger.md / 論点 0013

import {
  SPEED_ZONES,
  CHEER_TYPES,
  TIMES_OF_DAY,
  type SpeedZone,
  type CheerType,
  type TimeOfDay,
} from "./shared/types.js";

export type BucketKey = `${SpeedZone}_${CheerType}_${TimeOfDay}`;

export interface PoolMessage {
  id: string;
  text: string;
}

export interface MessagePool {
  characterId: string;
  version: number;
  buckets: Record<BucketKey, PoolMessage[]>;
}

// シナリオ: シナリオキーの決定的生成
export function bucketKey(zone: SpeedZone, type: CheerType, timeOfDay: TimeOfDay): BucketKey {
  return `${zone}_${type}_${timeOfDay}` as BucketKey;
}

// S0037_01 シナリオの応援種別で要求する文の数を決める
//
// 出典は論点 0037(1 キャラ 48 文)。バケットの構造(24 個)は変えずに文の数だけを減らした —
// 構造を畳む案は、選択の規則・時間帯・プロンプトまで波及するため採らなかった。
// milestone は発動がまれなので 1 文でも繰り返しが目立ちにくい。生成(agent)だけでなく
// 計測(eval)も同じ数を参照しうるので core に置く。読み込み時の検証条件ではない(S0037_04)。
export const MESSAGE_COUNT_BY_CHEER_TYPE: Readonly<Record<CheerType, number>> = {
  regular: 3,
  milestone: 1,
};

export function computeMessageCount(key: BucketKey): number {
  return MESSAGE_COUNT_BY_CHEER_TYPE[computeCheerType(key)];
}

// バケットキーの書式 `${SpeedZone}_${CheerType}_${TimeOfDay}`(bucketKey)の 2 番目。
// 書式の知識をここ 1 箇所に置く(文の数・画像タグの要求の両方が応援種別で分ける)
export function computeCheerType(key: BucketKey): CheerType {
  return key.split("_")[1] as CheerType;
}

// 24 シナリオの全列挙(zone × type × timeOfDay)
export const ALL_BUCKET_KEYS: readonly BucketKey[] = (() => {
  const keys: BucketKey[] = [];
  for (const z of SPEED_ZONES) {
    for (const t of CHEER_TYPES) {
      for (const d of TIMES_OF_DAY) {
        keys.push(bucketKey(z, t, d));
      }
    }
  }
  return keys;
})();

export const EXPECTED_BUCKET_COUNT = SPEED_ZONES.length * CHEER_TYPES.length * TIMES_OF_DAY.length;

const KEY_SET = new Set<string>(ALL_BUCKET_KEYS);

function isMessage(value: unknown): value is PoolMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["id"] === "string" && typeof v["text"] === "string";
}

// シナリオ: プール構造の契約 [境界]
export function isValidPool(input: unknown): input is MessagePool {
  if (typeof input !== "object" || input === null) return false;
  const root = input as Record<string, unknown>;
  const buckets = root["buckets"];
  if (typeof buckets !== "object" || buckets === null) return false;
  const b = buckets as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.length !== EXPECTED_BUCKET_COUNT) return false;
  for (const key of keys) {
    if (!KEY_SET.has(key)) return false;
    const arr = b[key];
    if (!Array.isArray(arr)) return false;
    for (const m of arr) {
      if (!isMessage(m)) return false;
    }
  }
  return true;
}

export function countMessages(pool: MessagePool): number {
  let total = 0;
  for (const key of ALL_BUCKET_KEYS) {
    total += pool.buckets[key].length;
  }
  return total;
}
