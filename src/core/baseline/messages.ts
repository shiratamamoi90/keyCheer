// Baseline 定型文(同梱)。プール未生成・バケット全欠損時のフォールバック。
// 1 文 30 字以内({milestone} は補間後も 30 字以内)、シナリオキー (zone, type, timeOfDay) ごとに 1 件以上。
// 文言の「良さ」は仕様外(→ 非決定的な論点(decisions/))。ここでは契約(存在・文字数)のみ tests/core/baseline.test.ts で縛る。
// 要件: docs/cheer-trigger.md「キャラ未作成時の発動」/ docs/data-model.md「Baseline 定型文(同梱)」

import type { SpeedZone, CheerType, TimeOfDay } from "../shared/types.js";

export type BaselineKey = `${SpeedZone}_${CheerType}_${TimeOfDay}`;

export const baselineMessages: Record<BaselineKey, string[]> = {
  // slow: ゆっくり寄り添う
  slow_regular_morning: ["おはよう、ゆっくりでいいよ", "朝はマイペースにいこう"],
  slow_regular_afternoon: ["午後ものんびりいこうね", "焦らなくて大丈夫だよ"],
  slow_regular_evening: ["夕方だね、無理しないで", "ここまでよく頑張ったね"],
  slow_regular_night: ["夜はゆったりいこう", "疲れたら休んでいいんだよ"],
  slow_milestone_morning: ["{milestone}回達成!朝から素敵!"],
  slow_milestone_afternoon: ["{milestone}回!着実な積み重ねだね"],
  slow_milestone_evening: ["{milestone}回達成、お疲れさま"],
  slow_milestone_night: ["夜までに{milestone}回、立派だよ"],

  // normal: 標準の応援
  normal_regular_morning: ["今日も良いペースだね!", "朝から順調、その調子!"],
  normal_regular_afternoon: ["午後もいい感じだよ!", "安定したペース、すごい!"],
  normal_regular_evening: ["夕方まで頑張ってるね!", "いいリズムをキープ中!"],
  normal_regular_night: ["夜も集中できてるね!", "コツコツ続けてえらい!"],
  normal_milestone_morning: ["{milestone}回達成!いいスタート!"],
  normal_milestone_afternoon: ["{milestone}回!順調そのもの!"],
  normal_milestone_evening: ["{milestone}回達成!今日も頑張った!"],
  normal_milestone_night: ["{milestone}回!コツコツの成果だね"],

  // fast: 勢いを煽る
  fast_regular_morning: ["朝から飛ばしてるね!最高!", "すごいスピード!その調子!"],
  fast_regular_afternoon: ["午後も全開だね!かっこいい!", "タイピングが火を噴いてる!"],
  fast_regular_evening: ["夕方なのにこの速さ!すごい!", "ラストスパートみたいだね!"],
  fast_regular_night: ["夜なのにフルスロットル!", "この勢い、止まらないね!"],
  fast_milestone_morning: ["朝から{milestone}回!爆速すぎる!"],
  fast_milestone_afternoon: ["{milestone}回突破!ノリノリだね!"],
  fast_milestone_evening: ["{milestone}回!勢いが止まらない!"],
  fast_milestone_night: ["深夜の{milestone}回!伝説級だよ!"],
};
