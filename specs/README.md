# 確定仕様(source of truth)

ここには **決定的な振る舞いの確定仕様**だけを置く。進行中は `changes/NNNN-*/spec.md` に書き、
人間の承認 → TDD 実装が済んだらここへ反映してアーカイブする。

> ステータス: KeyCheer は設計フェーズ。以下は**設計時点の意図**であり、各機能は
> `/new-change` → spec 承認 → `/run-loop`(Red→Green→Refactor)で実装・固定していく。
> 文言・画像の「良さ」など非決定的な事項はここに書かない(→ `experiments/`)。

## ファイル

- `key-counter.md` … グローバルキーカウント・アクティブ時間(60秒判定)
- `speed-zone.md` … 直近1分の KPM 算出・速度ゾーン分類(slow/normal/fast)
- `cheer-trigger.md` … 通常 N 回 / マイルストーン発動・速度ゾーン別キャッシュ選択
- `time-of-day.md` … 時(0..23 整数)→ `morning/afternoon/evening/night` の決定的分類
- `data-model.md` … 設定 / 統計 / ランタイム状態のデータ契約
- `integrations.md` … Ollama / VOICEVOX / sd.cpp 連携の決定的契約(失敗時フォールバック含む)

## 不変条件(全 spec に共通)

- **プライバシー**: キーの種類のみカウント。入力内容は保存・送信しない。通信は localhost のみ。
- **フォールバック**: 外部依存(Ollama/VOICEVOX/sd.cpp)が無くてもクラッシュしない。
- **再現性**: 乱数はシード固定可能。
