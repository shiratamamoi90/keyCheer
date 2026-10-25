// configFile: 論点フォルダの config.yaml を読む。
//
// 対象は**平らな `key: value` だけ**(入れ子・配列は読まない)。論点の config.yaml は
// 「1 論点 = 1 変数」の規律で平らに保たれているので、YAML パーサーを依存に足さずに済ませる
// (新規依存は審査が要る。@.claude/rules/security-rules.md)。入れ子が要る config が出てきたら、
// この関数を広げるのではなく依存の追加を論点にする。

export type FlatConfig = Record<string, string>;

export function parseFlatConfig(text: string): FlatConfig {
  const config: FlatConfig = {};
  for (const rawLine of text.split("\n")) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    config[key] = unquote(line.slice(colon + 1).trim());
  }
  return config;
}

// 引用符の中の `#` はコメントにしない(テンプレート文字列に含まれうる)
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(value: string): string {
  const first = value[0];
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

export function requireNumber(config: FlatConfig, key: string): number {
  const value = Number(config[key]);
  if (config[key] === undefined || !Number.isFinite(value)) {
    throw new Error(`config.yaml: ${key} が数値として読めない`);
  }
  return value;
}

export function requireString(config: FlatConfig, key: string): string {
  const value = config[key];
  if (value === undefined || value.length === 0) throw new Error(`config.yaml: ${key} が無い`);
  return value;
}
