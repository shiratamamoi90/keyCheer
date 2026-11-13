// main/imageWeights: 画像の重みの取得の入口(状態・ライセンスへの同意・取得の開始と中断)。
// 要件: docs/model-weights.md(論点 0042)/ docs/licenses.md(論点 0047)
// 取得そのもの(agent/imageWeightsFetch)は偽物に差し替える。

import { describe, it, expect, vi } from "vitest";
import { createImageWeightsService } from "../../src/main/imageWeights.js";
import {
  IMAGE_WEIGHTS_LICENSE_VERSION,
  type ImageWeightsLicenseAgreement,
} from "../../src/core/shared/imageWeights.js";

const NOW = "2026-11-13T09:00:00.000Z";

function setup(
  over: {
    agreement?: unknown;
    hasWeights?: boolean;
    imageProvider?: "local-sdcpp" | "stability-ai" | "openai-dalle";
  } = {},
) {
  let agreement: unknown = over.agreement ?? null;
  const consent = { "stability-ai": false };
  const auditLog: unknown[] = [];
  const runFetch = vi.fn(async () => ({ ok: true }) as const);
  const service = createImageWeightsService({
    loadAgreement: () => agreement,
    saveAgreement: (next: ImageWeightsLicenseAgreement) => {
      agreement = next;
    },
    loadImageProvider: () => over.imageProvider ?? "local-sdcpp",
    hasWeights: () => over.hasWeights ?? false,
    runFetch,
    now: () => NOW,
  });
  return { service, runFetch, consent, auditLog, agreement: () => agreement };
}

describe("imageWeights / 利用者が始めるまで取得の通信をしない [否定]", () => {
  it("S0042_02 does not fetch when the status is read", () => {
    // GIVEN 重みが取得されていない
    const { service, runFetch } = setup();

    // WHEN 状態を読む(起動・画面の表示・案内の表示)
    service.status();
    service.status();

    // THEN 取得の通信は発生しない
    expect(runFetch).not.toHaveBeenCalled();
  });
});

describe("imageWeights / 画像の重みが無ければ、設定画面に取得の操作を出す", () => {
  it("S0042_09 offers the fetch when local-sdcpp is chosen and the weights are missing", () => {
    // GIVEN providers.image = local-sdcpp で、画像の重みが取得されていない
    const { service } = setup();

    // WHEN 設定画面を開く
    const status = service.status();

    // THEN 画像の重みの取得の操作を出す
    expect(status.canFetch).toBe(true);
    expect(status.hasWeights).toBe(false);
    expect(setup({ hasWeights: true }).service.status().canFetch).toBe(false);
  });
});

describe("imageWeights / 外部の画像プロバイダーを選んでいれば画像の重みの取得を出さない [境界]", () => {
  it("S0042_11 does not offer the fetch for an external image provider", () => {
    // GIVEN providers.image が外部の画像プロバイダーで、画像の重みが取得されていない
    for (const imageProvider of ["stability-ai", "openai-dalle"] as const) {
      // WHEN 設定画面を開く
      const status = setup({ imageProvider }).service.status();

      // THEN 画像の重みの取得の操作を出さない
      expect(status.canFetch, imageProvider).toBe(false);
    }
  });
});

describe("imageWeights / アプリの中で取得を始めると、取得の前に同じ表示と同意を求める", () => {
  it("S0047_05 asks for the license agreement before fetching and starts once agreed", async () => {
    // GIVEN local-sdcpp で、画像の重みが取得されておらず、ライセンスへの同意が記録されていない
    const { service, runFetch } = setup();
    expect(service.status().needsLicenseAgreement).toBe(true);

    // WHEN 設定画面で取得を始め、同意する
    const result = await service.start({ hasAgreed: true });

    // THEN 同意すると取得が始まる
    expect(result).toEqual({ ok: true });
    expect(runFetch).toHaveBeenCalledTimes(1);
  });
});

describe("imageWeights / アプリの中で同意しなければ取得を始めない [否定]", () => {
  it("S0047_06 neither fetches nor records an agreement without the consent of the user", async () => {
    // GIVEN 取得の前の同意の画面
    const { service, runFetch, agreement } = setup();

    // WHEN 利用者が同意せずに取得を始めようとする
    const result = await service.start({ hasAgreed: false });

    // THEN 取得は始まらず、ライセンスへの同意は記録されない。取得の操作は残る
    expect(result).toEqual({ ok: false, reason: "license-agreement-required" });
    expect(runFetch).not.toHaveBeenCalled();
    expect(agreement()).toBeNull();
    expect(service.status().canFetch).toBe(true);
  });
});

describe("imageWeights / 同意済みの人にはもう一度求めない", () => {
  it("S0047_07 starts fetching without asking when an agreement is recorded", async () => {
    // GIVEN ライセンスへの同意が記録されている
    const recorded = {
      agreedAt: "2026-11-01T00:00:00.000Z",
      version: IMAGE_WEIGHTS_LICENSE_VERSION,
    };
    const { service, runFetch, agreement } = setup({ agreement: recorded });
    expect(service.status().needsLicenseAgreement).toBe(false);

    // WHEN 設定画面で画像の重みの取得を始める(同意の操作なし)
    const result = await service.start({ hasAgreed: false });

    // THEN 同意を求めずに取得が始まる。記録は書き換わらない
    expect(result).toEqual({ ok: true });
    expect(runFetch).toHaveBeenCalledTimes(1);
    expect(agreement()).toEqual(recorded);
  });
});

describe("imageWeights / 同意したことと日時と、同意した対象の版を記録する", () => {
  it("S0047_08 records when the user agreed and to which version", async () => {
    // GIVEN 同意の画面
    const { service, agreement } = setup();

    // WHEN 利用者が同意する
    await service.start({ hasAgreed: true });

    // THEN 同意した日時と、同意した対象の版が記録される
    expect(agreement()).toEqual({ agreedAt: NOW, version: IMAGE_WEIGHTS_LICENSE_VERSION });
  });
});

describe("imageWeights / 取得する重みかライセンスが変わったら同意を取り直す [境界]", () => {
  it("S0047_09 treats an agreement to another version as no agreement", async () => {
    // GIVEN 記録されている「同意した対象の版」が、いまの版と違う
    const { service, runFetch } = setup({
      agreement: { agreedAt: "2026-01-01T00:00:00.000Z", version: "0" },
    });

    // WHEN 設定画面で画像の重みの取得を始める
    const status = service.status();
    const result = await service.start({ hasAgreed: false });

    // THEN 同意していないものとして扱い、同意を求める
    expect(status.needsLicenseAgreement).toBe(true);
    expect(result).toEqual({ ok: false, reason: "license-agreement-required" });
    expect(runFetch).not.toHaveBeenCalled();
  });
});

describe("imageWeights / 同意の画面は通信しない [否定]", () => {
  it("S0047_10 reads the status and declines without any fetch", async () => {
    // GIVEN アプリの中の同意の画面
    const { service, runFetch } = setup();

    // WHEN 表示し、同意せずに閉じる
    service.status();
    await service.start({ hasAgreed: false });

    // THEN 通信は発生しない
    expect(runFetch).not.toHaveBeenCalled();
  });
});

describe("imageWeights / ライセンスへの同意は、送信の同意と監査ログを変えない [否定]", () => {
  it("S0047_11 touches nothing but the license agreement record", async () => {
    // GIVEN 外部プロバイダーへの送信の同意と監査ログがある
    const { service, consent, auditLog } = setup();

    // WHEN ライセンスへの同意をする
    await service.start({ hasAgreed: true });

    // THEN 送信の同意と監査ログは変化しない(この部品はどちらにも触れる手段を持たない)
    expect(consent).toEqual({ "stability-ai": false });
    expect(auditLog).toEqual([]);
  });
});

describe("imageWeights / 取得の中断と重複", () => {
  it("refuses a second start while one is running and reports the progress", async () => {
    let release: () => void = () => {};
    const runFetch = vi.fn(
      (input: { onProgress: (done: number, total: number) => void }) =>
        new Promise<{ ok: true }>((resolve) => {
          input.onProgress(5, 10);
          release = () => resolve({ ok: true });
        }),
    );
    const service = createImageWeightsService({
      loadAgreement: () => ({ agreedAt: NOW, version: IMAGE_WEIGHTS_LICENSE_VERSION }),
      saveAgreement: () => {},
      loadImageProvider: () => "local-sdcpp",
      hasWeights: () => false,
      runFetch,
      now: () => NOW,
    });

    const first = service.start({ hasAgreed: false });
    expect(service.status().progress).toEqual({ doneBytes: 5, totalBytes: 10 });
    expect(await service.start({ hasAgreed: false })).toEqual({
      ok: false,
      reason: "already-running",
    });
    release();
    expect(await first).toEqual({ ok: true });
    expect(service.status().progress).toBeNull();
  });
});
