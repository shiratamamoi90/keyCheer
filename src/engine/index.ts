// engine: 決定的コア。純粋関数のみ。Electron API・I/O・fetch・child_process を import しない。
// 詳細は .claude/rules/architecture.md / impl-rules.md

export {
  isActive,
  recordKeyPress,
  initialKeyCounterState,
  type KeyCounterState,
} from "./keyCounter.js";

export { computeKpm, classifyZone, KPM_WINDOW_MS } from "./speedZone.js";

export { shouldFire } from "./trigger.js";

export {
  DEFAULT_TRIGGER_CONFIG,
  validateTriggerConfig,
  mergeWithDefaults,
  migrateLegacyDefaults,
  type ValidateResult,
} from "./triggerConfig.js";

export {
  bucketKey,
  ALL_BUCKET_KEYS,
  EXPECTED_BUCKET_COUNT,
  isValidPool,
  countMessages,
  type BucketKey,
  type PoolMessage,
  type MessagePool,
} from "./messagePool.js";

export {
  selectCheer,
  type SelectionSource,
  type CheerSelectorInput,
  type CheerSelection,
} from "./cheerSelector.js";

export {
  classifyTimeOfDay,
  classifyTimeOfDayFromDate,
  MORNING_START,
  AFTERNOON_START,
  EVENING_START,
  NIGHT_START,
} from "./timeOfDay.js";
