// log: main のログ。先頭にプロジェクトの名前(keyCheer。論点 0077 — 見える名前ではなくプロジェクトの名前)を付ける。
// 入力の内容・キーの並びは決して渡さない(プライバシー方針。数・状態・理由だけを書く)。

const LOG_PREFIX = "[keycheer]";

export function logError(message: string, ...details: unknown[]): void {
  console.error(`${LOG_PREFIX} ${message}`, ...details);
}

export function logWarn(message: string, ...details: unknown[]): void {
  console.warn(`${LOG_PREFIX} ${message}`, ...details);
}

export function logInfo(message: string, ...details: unknown[]): void {
  console.info(`${LOG_PREFIX} ${message}`, ...details);
}
