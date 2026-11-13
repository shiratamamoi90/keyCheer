// weightPartStore: 重みの取得の途中のファイルと、置き場の操作(Node の fs)。
// 要件: docs/model-weights.md S0042_03〜06(論点 0042)。agent/imageWeightsFetch に注入する。
// Electron に触れないので、一時フォルダを使って単体で確かめられる。

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { WeightPartStore } from "../agent/imageWeightsFetch.js";

const PART_SUFFIX = ".part";

// 途中のファイルは「置き先 + .part」。照合に通ったときだけ置き先の名前にする(途中の取得物を使わない)
export function createNodeWeightPartStore(weightsDir: string): WeightPartStore {
  const openParts = new Map<string, number>();
  const closePart = (destPath: string): void => {
    const fd = openParts.get(destPath);
    if (fd !== undefined) {
      closeSync(fd);
      openParts.delete(destPath);
    }
  };
  return {
    exists: (destPath) => existsSync(destPath),
    partSize: (destPath) => {
      const part = destPath + PART_SUFFIX;
      return existsSync(part) ? statSync(part).size : 0;
    },
    appendPart: (destPath, chunk) => {
      let fd = openParts.get(destPath);
      if (fd === undefined) {
        mkdirSync(dirname(destPath), { recursive: true });
        fd = openSync(destPath + PART_SUFFIX, "a");
        openParts.set(destPath, fd);
      }
      writeSync(fd, chunk);
    },
    resetPart: (destPath) => {
      closePart(destPath);
      rmSync(destPath + PART_SUFFIX, { force: true });
    },
    hashPart: (destPath) => {
      closePart(destPath);
      return new Promise<string>((resolve, reject) => {
        const hash = createHash("sha256");
        createReadStream(destPath + PART_SUFFIX)
          .on("data", (chunk) => hash.update(chunk))
          .on("end", () => resolve(hash.digest("hex")))
          .on("error", reject);
      });
    },
    commitPart: (destPath) => {
      closePart(destPath);
      renameSync(destPath + PART_SUFFIX, destPath);
    },
    freeBytes: () => {
      mkdirSync(weightsDir, { recursive: true });
      const stats = statfsSync(weightsDir);
      return stats.bavail * stats.bsize;
    },
  };
}
