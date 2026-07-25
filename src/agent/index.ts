// agent: 非決定的 I/O アダプタ。プロバイダー実装・プール生成・音声合成・再生計画。
// engine を利用するが、engine は agent を import しない(architecture.md)。
//
// ここは **意図的にバレル(re-export)にしない**。まとめて公開すると、発動経路
// (main/cheerRuntime)がこのファイル経由で providers・生成系を引き込めてしまい、
// eslint の no-restricted-imports(発動経路 → providers 禁止)をすり抜けるため。
// 利用側は `../agent/cheerPlayer.js` のように必要なモジュールを直接 import する。
export {};
