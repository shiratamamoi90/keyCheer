// imageWeightsFetch: 画像の重みを取得元から取得する(進捗・中断・続きから・照合・空き容量)。
// 要件: docs/model-weights.md S0042_03〜06 / S0042_12(論点 0042)
//
// 重みの取得は「受け取るだけの通信」で、利用者の情報を送らない。外部プロバイダーへの送信ではないので、
// 同意ダイアログも監査ログも通さない(@.claude/rules/security-rules.md「このプロジェクト固有」)。
// 通信とファイルは注入する(テストで実際の取得元に繋がない)。応援発動経路からは import しない。

export interface WeightDownload {
  url: string;
  destPath: string;
  sha256: string;
  byteSize: number;
}

// 取得の途中のファイル(part)と、置き場の操作。数 GB を扱うので、中身をメモリに持たずに追記していく
export interface WeightPartStore {
  exists(destPath: string): boolean; // 照合に通って置かれているか
  partSize(destPath: string): number; // 途中まで取得した量(無ければ 0)
  appendPart(destPath: string, chunk: Uint8Array): void | Promise<void>;
  resetPart(destPath: string): void;
  hashPart(destPath: string): Promise<string>; // 途中のファイルの sha256(16 進)
  commitPart(destPath: string): void; // 途中のファイルを置き先の名前にする
  freeBytes(): number | Promise<number>;
}

export type FetchWeightsResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "network" | "hash-mismatch" | "insufficient-space" };

export interface FetchImageWeightsInput {
  files: readonly WeightDownload[];
  store: WeightPartStore;
  fetchFn?: typeof fetch;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  shouldCancel?: () => boolean;
}

const HTTP_PARTIAL_CONTENT = 206;

export async function fetchImageWeights(
  input: FetchImageWeightsInput,
): Promise<FetchWeightsResult> {
  const { files, store, fetchFn = fetch } = input;
  const pending = files.filter((file) => !store.exists(file.destPath));
  const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
  let doneBytes = files
    .filter((file) => store.exists(file.destPath))
    .reduce((sum, file) => sum + file.byteSize, 0);

  // S0042_06 空き容量が足りなければ取得を始めない — 通信の前に確かめる
  const remainingBytes = pending.reduce(
    (sum, file) => sum + Math.max(file.byteSize - store.partSize(file.destPath), 0),
    0,
  );
  if ((await store.freeBytes()) < remainingBytes)
    return { ok: false, reason: "insufficient-space" };

  for (const file of pending) {
    // S0042_04 中断・通信断のあとは続きから取得する
    let offset = store.partSize(file.destPath);
    if (offset > file.byteSize) {
      store.resetPart(file.destPath);
      offset = 0;
    }
    if (offset < file.byteSize) {
      let response: Response;
      try {
        // S0042_12 送るのは重みを受け取るための要求だけ(本文なし。ヘッダーは続きを取るための Range だけ)
        response = await fetchFn(
          file.url,
          offset > 0 ? { headers: { Range: `bytes=${offset}-` } } : {},
        );
      } catch {
        return { ok: false, reason: "network" };
      }
      if (!response.ok || response.body === null) return { ok: false, reason: "network" };
      // 取得元が続きからの取得に応じなかった(全部を返してきた)ときは、取得済みの分を捨てて最初から受け取る
      if (offset > 0 && response.status !== HTTP_PARTIAL_CONTENT) {
        store.resetPart(file.destPath);
        offset = 0;
      }

      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await store.appendPart(file.destPath, value);
          offset += value.length;
          // S0042_03 取得中は進捗を示し、中断できる — 中断しても取得した分は残す
          input.onProgress?.(doneBytes + offset, totalBytes);
          if (input.shouldCancel?.() === true) {
            await reader.cancel();
            return { ok: false, reason: "cancelled" };
          }
        }
      } catch {
        return { ok: false, reason: "network" };
      }
    }

    // S0042_05 ハッシュが一致しなければ使わない — 一致したものだけを置き先の名前にする。
    // 一致しなかった取得物は捨てる(残すと、次の取得が壊れたものの続きから始まる)
    if ((await store.hashPart(file.destPath)) !== file.sha256) {
      store.resetPart(file.destPath);
      return { ok: false, reason: "hash-mismatch" };
    }
    store.commitPart(file.destPath);
    doneBytes += file.byteSize;
  }
  return { ok: true };
}
