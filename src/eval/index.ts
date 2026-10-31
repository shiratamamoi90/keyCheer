// eval: 探索ループの評価スクリプト。非決定的な論点(decisions/)の指標計測を駆動する。
//
// 使い方: npm run eval -- <論点フォルダ>
//   例: npm run eval -- decisions/undecided/0027-local-text-model-sarashina
// 論点フォルダの config.yaml を読み、baseline と variant を同じ条件で測る。
// 振る変数は `axis` で選ぶ:model(既定。論点 0027)はモデル名、prompt(論点 0026)はプロンプト案。
// 既定を model にするのは、決定済みの 0027 の config.yaml を書き換えずに再実行できるようにするため。
// 生の記録(JSONL)は KEYCHEER_EVAL_OUT(既定 ~/.cache/keycheer-eval)に置き、リポジトリには
// 入れない。result.md に書くのは集計値だけ(@.claude/rules/experiment-rules.md「規律」)。

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { buildSystemPrompt } from "../agent/poolGenerator.js";
import { DEFAULT_SYSTEM_CONFIG } from "../core/shared/types.js";
import { parseFlatConfig, requireNumber, requireString, type FlatConfig } from "./configFile.js";
import { resolvePromptBuilder } from "./promptVariant.js";
import { computeSummary, runTrials, type ComparisonSettings } from "./textModelComparison.js";

type VariantSettings = Pick<ComparisonSettings, "variant" | "model" | "buildPrompt">;

// 比べる 2 案を baseline → variant の順で作る
function buildVariants(config: FlatConfig): VariantSettings[] {
  const axis = config.axis ?? "model";
  if (axis === "model") {
    return [requireString(config, "baseline"), requireString(config, "ollama_model")].map(
      (model) => ({ variant: model, model, buildPrompt: buildSystemPrompt }),
    );
  }
  if (axis === "prompt") {
    const model = requireString(config, "model");
    return [requireString(config, "baseline"), requireString(config, "variant")].map((name) => ({
      variant: name,
      model,
      buildPrompt: resolvePromptBuilder(name),
    }));
  }
  throw new Error(`config.yaml: axis ${axis} は model / prompt のどちらか`);
}

async function main(): Promise<void> {
  const topicDir = process.argv[2];
  if (topicDir === undefined) throw new Error("論点フォルダを指定する: npm run eval -- <dir>");
  const config = parseFlatConfig(readFileSync(join(topicDir, "config.yaml"), "utf8"));

  const outDir = process.env.KEYCHEER_EVAL_OUT ?? join(homedir(), ".cache", "keycheer-eval");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `${basename(topicDir)}-${stamp}.jsonl`);

  const common: Omit<ComparisonSettings, keyof VariantSettings> = {
    endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
    baseSeed: requireNumber(config, "seed"),
    generationsPerCase: requireNumber(config, "generations_per_case"),
    timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
    characterCount: requireNumber(config, "characters"),
  };
  // 案の名前を先に全部引く。未知の名前で 1 案目を測り終えてから落ちると、その計測が無駄になる
  const variants = buildVariants(config);

  const summaries = [];
  for (const variant of variants) {
    let done = 0;
    const records = await runTrials({ ...common, ...variant }, (record) => {
      appendFileSync(outFile, `${JSON.stringify(record)}\n`);
      done += 1;
      if (done % 24 === 0) console.error(`[eval] ${variant.variant}: ${done} buckets`);
    });
    summaries.push(computeSummary(variant.variant, records));
  }

  console.log(JSON.stringify({ topic: basename(topicDir), outFile, summaries }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
