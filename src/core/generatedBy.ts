// generatedBy: 生成元プロバイダー(`character.generatedBy`)の記録。純粋関数のみ。
// spec: 論点 0022 / docs/integrations.md「生成元の記録」/ docs/data-model.md
//
// 記録するのは「実際にそのキャラを作った」プロバイダーで、`providers` の選択値ではない。
// 選択値から埋める関数をここに置かないのはそのため(S0022_04 / S0022_09)。
// 応援発動経路からは import しない(S0022_08。core/index.ts にも再エクスポートしない)。

import { isImageProviderId, isTextProviderId, isVoiceProviderId } from "./providers/registry.js";
import type { GeneratedBy } from "./shared/types.js";

// S0022_05 種別ごとの記録が他の種別を壊さない / S0022_06 再生成で生成元が更新される
//
// 完了した種別だけを上書きし、それ以外は current の値を残す。完了の判定は種別ごとに独立
// (論点 0022 決定 2)なので、ここでは「渡された種別 = 欠損なく完了した種別」として扱う。
export function applyGeneratedBy(
  current: GeneratedBy | undefined,
  completed: GeneratedBy,
): GeneratedBy {
  return { ...current, ...completed };
}

// S0022_10 値はプロバイダー識別子の定義域に従う
// 未設定は許す(作っていない種別は持たない)。種別をまたいだ識別子も定義域外。
export function validateGeneratedBy(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return ["generatedBy is not an object"];
  const record = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (record.text !== undefined && !isTextProviderId(record.text)) {
    errors.push(`generatedBy.text is out of domain: ${String(record.text)}`);
  }
  if (record.voice !== undefined && !isVoiceProviderId(record.voice)) {
    errors.push(`generatedBy.voice is out of domain: ${String(record.voice)}`);
  }
  if (record.image !== undefined && !isImageProviderId(record.image)) {
    errors.push(`generatedBy.image is out of domain: ${String(record.image)}`);
  }
  return errors;
}
