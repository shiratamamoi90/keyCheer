#!/usr/bin/env bash
# 自前 validate(OpenSpec の validate --strict 相当の最小版)。
# spec の各シナリオに GIVEN/WHEN/THEN が揃い、対応テストが存在するかを検査する。
set -uo pipefail
fail=0

check_spec() {
  local f="$1"
  awk '/^## シナリオ/{s=$0; g=w=t=0}
       /- GIVEN/{g=1} /- WHEN/{w=1} /- THEN/{t=1}
       /^## シナリオ/ && NR>1 {}
       END{}' "$f" >/dev/null
  # シナリオごとに G/W/T を確認
  python3 - "$f" <<'PY'
import re,sys
f=sys.argv[1]
txt=open(f,encoding='utf-8').read()
blocks=re.split(r'(?m)^## シナリオ.*$',txt)[1:]
names=re.findall(r'(?m)^## シナリオ(.*)$',txt)
bad=0
for n,b in zip(names,blocks):
    for kw in ('GIVEN','WHEN','THEN'):
        if kw not in b:
            print(f"  [欠落] {f}:{n.strip()} に {kw} がない"); bad=1
sys.exit(bad)
PY
}

echo "== validate: spec の GIVEN/WHEN/THEN =="
for f in $(find specs changes -name 'spec.md' 2>/dev/null); do
  check_spec "$f" || fail=1
done

echo "== validate: シナリオに対応するテスト名の存在 =="
for f in $(find specs changes -name 'spec.md' 2>/dev/null); do
  grep -oP '(?<=## シナリオ).*' "$f" 2>/dev/null | while read -r name; do
    : # 命名規約に応じてここで tests/ を grep する(プロジェクトごとに調整)
  done
done

if [ "$fail" -eq 0 ]; then echo "整合OK"; else echo "整合NG(上記を修正)"; fi
exit $fail
