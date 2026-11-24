import { describe, expect, it } from "vitest";
import { removeRetiredFiles } from "../../src/main/retiredFiles.js";

const USER_DATA = "/u";
const SECRETS = "/u/secrets.json";
const AUDIT_LOG = "/u/audit.log.json";

// 置き場を表す偽物。消した結果と、消そうとしたパスを残す
function makeFakeFs(initial: string[], failing: string[] = []) {
  const files = new Set(initial);
  const attempted: string[] = [];
  return {
    files,
    attempted,
    removeFile: (path: string) => {
      attempted.push(path);
      if (failing.includes(path)) throw new Error("EBUSY");
      files.delete(path);
    },
  };
}

describe("前の版が残したもの(論点 0054)", () => {
  it("S0054_01 removes the previous version's API key store at startup", () => {
    const fs = makeFakeFs([SECRETS]);
    removeRetiredFiles({ userDataDir: USER_DATA, removeFile: fs.removeFile });
    expect(fs.files.has(SECRETS)).toBe(false);
  });

  it("S0054_02 removes the previous version's audit log at startup", () => {
    const fs = makeFakeFs([AUDIT_LOG]);
    removeRetiredFiles({ userDataDir: USER_DATA, removeFile: fs.removeFile });
    expect(fs.files.has(AUDIT_LOG)).toBe(false);
  });

  it("S0054_03 keeps starting when the files are missing or cannot be removed", () => {
    const fs = makeFakeFs([SECRETS], [SECRETS, AUDIT_LOG]);
    expect(() =>
      removeRetiredFiles({ userDataDir: USER_DATA, removeFile: fs.removeFile }),
    ).not.toThrow();
    // 1 つ目で失敗しても 2 つ目を試す
    expect(fs.attempted).toEqual([SECRETS, AUDIT_LOG]);
  });

  it("S0054_04 touches no other files", () => {
    const others = [
      "/u/config.json",
      "/u/characters/c1/pool.json",
      "/u/characters/c1/voices/a.wav",
      "/u/characters/c1/images/idle.png",
      "/u/weights/image/Counterfeit-V3.0_fix_fp16.safetensors",
    ];
    const fs = makeFakeFs([SECRETS, AUDIT_LOG, ...others]);
    removeRetiredFiles({ userDataDir: USER_DATA, removeFile: fs.removeFile });
    expect(fs.attempted).toEqual([SECRETS, AUDIT_LOG]);
    expect([...fs.files].sort()).toEqual([...others].sort());
  });
});
