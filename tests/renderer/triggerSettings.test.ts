// renderer/triggerSettings: 設定画面の「応援」の欄(回数・秒数・節目)の入力を確定して保存する。
// 要件: docs/main-window.md(論点 0070)

import { describe, expect, it } from "vitest";
import { createTriggerSettingsController } from "../../src/renderer/triggerSettings.js";
import type { TriggerConfig } from "../../src/core/shared/types.js";

const BASE: TriggerConfig = {
  regular: 50,
  activeThresholdSec: 60,
  milestoneInterval: 250,
  isMilestoneEnabled: true,
};

function setup(config: TriggerConfig = BASE) {
  const saved: TriggerConfig[] = [];
  const controller = createTriggerSettingsController({
    config,
    save: (next) => saved.push(next),
  });
  return { controller, saved };
}

describe("triggerSettings / 設定画面に応援の回数・秒数・節目を出す", () => {
  it("S0070_01 shows the saved regular, seconds, milestone interval and the milestone switch", () => {
    const { controller } = setup({
      regular: 30,
      activeThresholdSec: 90,
      milestoneInterval: 500,
      isMilestoneEnabled: true,
    });
    expect(controller.getConfig()).toEqual({
      regular: 30,
      activeThresholdSec: 90,
      milestoneInterval: 500,
      isMilestoneEnabled: true,
    });
  });
});

describe("triggerSettings / 確定した値をすぐ保存する", () => {
  it("S0070_02 saves regular = 80 as soon as the input is committed", () => {
    const { controller, saved } = setup();
    expect(controller.commitField("regular", "80")).toBe(80);
    expect(saved).toEqual([{ ...BASE, regular: 80 }]);
  });
});

describe("triggerSettings / 確定する前の入力は保存しない [否定]", () => {
  it("S0070_03 saves nothing until an input is committed", () => {
    const { controller, saved } = setup();
    // 打っている途中の値は controller に渡らない(確定したときだけ commitField を呼ぶ)
    expect(saved).toEqual([]);
    expect(controller.getConfig().regular).toBe(50);
  });
});

describe("triggerSettings / 範囲より小さい値・大きい値は端の値にする [境界]", () => {
  it("S0070_04 clamps each field to its range and saves the clamped value", () => {
    const { controller, saved } = setup();
    expect(controller.commitField("activeThresholdSec", "1")).toBe(5);
    expect(controller.commitField("activeThresholdSec", "9999")).toBe(600);
    expect(controller.commitField("regular", "0")).toBe(1);
    expect(controller.commitField("milestoneInterval", "999999")).toBe(100_000);
    expect(saved.at(-1)).toEqual({
      regular: 1,
      activeThresholdSec: 600,
      milestoneInterval: 100_000,
      isMilestoneEnabled: true,
    });
  });
});

describe("triggerSettings / 小数は切り捨てて整数にする [境界]", () => {
  it("S0070_05 truncates 80.7 to 80", () => {
    const { controller, saved } = setup();
    expect(controller.commitField("regular", "80.7")).toBe(80);
    expect(saved).toEqual([{ ...BASE, regular: 80 }]);
  });
});

describe("triggerSettings / 空や数でない入力は保存されている値に戻す [異常系]", () => {
  it("S0070_06 returns the saved value for an empty or non-numeric input without saving", () => {
    const { controller, saved } = setup();
    expect(controller.commitField("regular", "")).toBe(50);
    expect(controller.commitField("regular", "abc")).toBe(50);
    expect(saved).toEqual([]);
  });
});

describe("triggerSettings / 回数を節目以上に、節目を回数以下にできない [否定]", () => {
  it("S0070_07 keeps milestoneInterval above regular in both directions, also while disabled", () => {
    const { controller, saved } = setup();
    expect(controller.commitField("regular", "300")).toBe(249);
    expect(controller.commitField("milestoneInterval", "40")).toBe(250);

    const off = setup({ ...BASE, isMilestoneEnabled: false });
    // 節目の回数は出さない間は変えられないので、回数の側で範囲が同じことを見る
    expect(off.controller.commitField("regular", "300")).toBe(249);
    for (const config of [...saved, ...off.saved]) {
      expect(config.milestoneInterval).toBeGreaterThan(config.regular);
    }
  });
});

describe("triggerSettings / 節目の応援を出さない間は節目の回数を変えられない [境界]", () => {
  it("S0070_08 saves isMilestoneEnabled = false, keeps the interval and makes its field not editable", () => {
    const { controller, saved } = setup();
    expect(controller.isMilestoneIntervalEditable()).toBe(true);
    controller.setMilestoneEnabled(false);
    expect(saved).toEqual([{ ...BASE, isMilestoneEnabled: false }]);
    expect(controller.isMilestoneIntervalEditable()).toBe(false);
    expect(controller.commitField("milestoneInterval", "500")).toBe(250);
    expect(saved).toHaveLength(1);
  });
});
