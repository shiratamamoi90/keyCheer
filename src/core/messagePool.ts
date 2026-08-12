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
