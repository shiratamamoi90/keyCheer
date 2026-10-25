// textModelComparison: ローカルのテキストモデルを baseline と比べる計測(論点 0027)。
//
// アプリと同じ経路で呼ぶ:プロンプトは buildSystemPrompt、呼び出しは createOllamaTextGenerator
// (応答スキーマ付き。論点 0024)、後処理は buildMessageTexts。経路を eval 側で組み直すと、
// 測った値がアプリの挙動と食い違う。振るのはモデル名だけ(1 論点 = 1 変数)。
// temperature は渡さない — アプリも渡しておらず、両モデルとも Modelfile で上書きしていないので
// Ollama 既定(0.8 = config.yaml の temperature)が効く。

import { buildSystemPrompt, MESSAGES_PER_BUCKET } from "../agent/poolGenerator.js";
import { createOllamaTextGenerator } from "../agent/providers/localOllama.js";
import { ALL_BUCKET_KEYS, type BucketKey } from "../core/messagePool.js";
import { buildMessageTexts, MAX_MESSAGE_LENGTH } from "../core/textResponse.js";
import type { CharacterProfile } from "../agent/poolGenerator.js";

// 評価データ:性格の異なる固定プロフィール 3 種(論点 0026 / 0027 の「キャラ 3 種」)。
// 変えると過去の計測と比べられなくなるので固定する(@.claude/rules/experiment-rules.md「規律」)。
export const EVAL_CHARACTERS: readonly CharacterProfile[] = [
  { name: "チア", personality: "元気いっぱいで面倒見がいい。語尾は明るく、いつも前向き" },
  { name: "シズク", personality: "落ち着いていて丁寧。静かに寄り添い、敬語で話す" },
  { name: "レン", personality: "クールで少し皮肉屋。ぶっきらぼうだが本当は応援している" },
];

export interface ComparisonSettings {
  endpoint: string;
  model: string;
  baseSeed: number;
  generationsPerCase: number;
  timeoutMsPerBucket: number;
  characterCount: number;
}

export interface BucketRecord {
  model: string;
  character: string;
  bucket: BucketKey;
  trial: number;
  seed: number;
  latencyMs: number;
  // 層 3 を通す前の要素(failed なら空)
  raw: string[];
  texts: string[];
  failed: boolean;
  error?: string;
}

export async function runModelTrials(
  settings: ComparisonSettings,
  onRecord: (record: BucketRecord) => void,
): Promise<BucketRecord[]> {
  const generator = createOllamaTextGenerator({
    endpoint: settings.endpoint,
    model: settings.model,
  });
  const records: BucketRecord[] = [];
  const characters = EVAL_CHARACTERS.slice(0, settings.characterCount);

  // 1 回目はモデルの読み込みを含むので、レイテンシに混ぜないよう捨てる
  await generator
    .generateMessages({
      systemPrompt: buildSystemPrompt(characters[0]!, ALL_BUCKET_KEYS[0]!, MESSAGES_PER_BUCKET),
      scenarioKey: ALL_BUCKET_KEYS[0]!,
      count: MESSAGES_PER_BUCKET,
      seed: settings.baseSeed,
      timeoutMs: settings.timeoutMsPerBucket,
    })
    .catch(() => []);

  for (let trial = 0; trial < settings.generationsPerCase; trial++) {
    // 同じシードを繰り返すと同じ出力になり試行にならない。試行ごとに seed + trial
    const seed = settings.baseSeed + trial;
    for (const character of characters) {
      for (const bucket of ALL_BUCKET_KEYS) {
        const started = performance.now();
        let record: BucketRecord;
        try {
          const raw = await generator.generateMessages({
            systemPrompt: buildSystemPrompt(character, bucket, MESSAGES_PER_BUCKET),
            scenarioKey: bucket,
            count: MESSAGES_PER_BUCKET,
            seed,
            timeoutMs: settings.timeoutMsPerBucket,
          });
          const texts = buildMessageTexts(raw, MESSAGES_PER_BUCKET);
          record = {
            ...base(),
            raw,
            texts,
            // poolGenerator と同じ判定:全文が空なら failed
            failed: texts.length === 0,
          };
        } catch (error) {
          record = { ...base(), raw: [], texts: [], failed: true, error: String(error) };
        }
        records.push(record);
        onRecord(record);

        function base() {
          return {
            model: settings.model,
            character: character.name,
            bucket,
            trial,
            seed,
            latencyMs: Math.round(performance.now() - started),
          };
        }
      }
    }
  }
  return records;
}

// --- 指標(論点 0027「測り方」)。どれも記録から決定的に計算する ---

const JAPANESE_CHAR = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/gu;
const LATIN_CHAR = /[A-Za-z]/g;

// 日本語の文:日本語の文字(かな・漢字)を 1 文字以上含み、かつ英字より多い
export function isJapaneseSentence(text: string): boolean {
  const japanese = text.match(JAPANESE_CHAR)?.length ?? 0;
  const latin = text.match(LATIN_CHAR)?.length ?? 0;
  return japanese > 0 && japanese > latin;
}

// 書式混入:層 3(記号の除去)が何かを落とした要素。
// 記号が無ければ層 3 は trim と 30 字切り詰めしかしないので、それと一致するかで判定する
export function hasFormatMarkers(raw: string): boolean {
  const withoutMarkers = [...raw.trim()].slice(0, MAX_MESSAGE_LENGTH).join("");
  const parsed = buildMessageTexts([raw], 1);
  return withoutMarkers.length > 0 && parsed[0] !== withoutMarkers;
}

export interface ComparisonSummary {
  model: string;
  buckets: number;
  japaneseRatePct: number;
  failedBucketRatePct: number;
  formatContaminationRatePct: number;
  overLengthRatePct: number;
  fillRatePct: number;
  meanLatencyMs: number;
}

export function computeSummary(model: string, records: readonly BucketRecord[]): ComparisonSummary {
  const texts = records.flatMap((r) => r.texts);
  const raws = records.flatMap((r) => r.raw);
  const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  return {
    model,
    buckets: records.length,
    japaneseRatePct: pct(texts.filter(isJapaneseSentence).length, texts.length),
    failedBucketRatePct: pct(records.filter((r) => r.failed).length, records.length),
    formatContaminationRatePct: pct(raws.filter(hasFormatMarkers).length, raws.length),
    // 契約違反(30 字超過)は層 3 の前の要素で数える。切り詰めで救われるが文の途中で切れる
    overLengthRatePct: pct(
      raws.filter((t) => [...t.trim()].length > MAX_MESSAGE_LENGTH).length,
      raws.length,
    ),
    // 件数充足率:要求した MESSAGES_PER_BUCKET 件に対し、プールに入った件数
    fillRatePct: pct(texts.length, records.length * MESSAGES_PER_BUCKET),
    meanLatencyMs: Math.round(
      records.reduce((sum, r) => sum + r.latencyMs, 0) / Math.max(records.length, 1),
    ),
  };
}
