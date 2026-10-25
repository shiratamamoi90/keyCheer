// eval: 探索ループの評価スクリプト。非決定的な論点(decisions/)の指標計測を駆動する。
//
// 使い方: npm run eval -- <論点フォルダ>
//   例: npm run eval -- decisions/undecided/0027-local-text-model-sarashina
// 論点フォルダの config.yaml を読み、baseline と variant を同じ条件で測る。
// 生の記録(JSONL)は KEYCHEER_EVAL_OUT(既定 ~/.cache/keycheer-eval)に置き、リポジトリには
// 入れない。result.md に書くのは集計値だけ(@.claude/rules/experiment-rules.md「規律」)。

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { DEFAULT_SYSTEM_CONFIG } from "../core/shared/types.js";
import { parseFlatConfig, requireNumber, requireString } from "./configFile.js";
import { computeSummary, runModelTrials, type ComparisonSettings } from "./textModelComparison.js";

async function main(): Promise<void> {
  const topicDir = process.argv[2];
  if (topicDir === undefined) throw new Error("論点フォルダを指定する: npm run eval -- <dir>");
  const config = parseFlatConfig(readFileSync(join(topicDir, "config.yaml"), "utf8"));

  const outDir = process.env.KEYCHEER_EVAL_OUT ?? join(homedir(), ".cache", "keycheer-eval");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `${basename(topicDir)}-${stamp}.jsonl`);

  const common: Omit<ComparisonSettings, "model"> = {
    endpoint: process.env.KEYCHEER_OLLAMA_ENDPOINT ?? DEFAULT_SYSTEM_CONFIG.ollamaEndpoint,
    baseSeed: requireNumber(config, "seed"),
    generationsPerCase: requireNumber(config, "generations_per_case"),
    timeoutMsPerBucket: requireNumber(config, "timeout_ms_per_bucket"),
    characterCount: requireNumber(config, "characters"),
  };
  const models = [requireString(config, "baseline"), requireString(config, "ollama_model")];

  const summaries = [];
  for (const model of models) {
    let done = 0;
    const records = await runModelTrials({ ...common, model }, (record) => {
      appendFileSync(outFile, `${JSON.stringify(record)}\n`);
      done += 1;
      if (done % 24 === 0) console.error(`[eval] ${model}: ${done} buckets`);
    });
    summaries.push(computeSummary(model, records));
  }

  console.log(JSON.stringify({ topic: basename(topicDir), outFile, summaries }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
