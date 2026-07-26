# 確定仕様(source of truth)

ここには **決定的な振る舞いの確定仕様**だけを置く。仕様は人間が承認し、TDD 実装が済んだ時点でここへ反映する。

> ステータス: engine(決定的コア)は TDD 実装済み(key-counter / speed-zone / cheer-trigger /
> time-of-day / baseline 定型文 / hasCharacter)。agent(プロバイダー I/O・プール生成・事前合成)と
> main の発動経路・メインウィンドウ開閉も実装済み。
> UI(renderer / preload)は最小構成のみ、キャラ作成フロー本体(フォーム・同意ダイアログ)は未実装 —
> 詳細な進捗はリポジトリ直下の `README.md`。
> 文言・画像の「良さ」など非決定的な事項はここに書かない(指標で計測して判断する)。

## ファイル

- `key-counter.md` … グローバルキーカウント・アクティブ時間(60秒判定)
- `speed-zone.md` … 直近1分の KPM 算出・速度ゾーン分類(slow/normal/fast)
- `cheer-trigger.md` … 通常 N 回 / マイルストーン発動・速度ゾーン別キャッシュ選択
- `time-of-day.md` … 時(0..23 整数)→ `morning/afternoon/evening/night` の決定的分類
- `data-model.md` … 設定 / 統計 / ランタイム状態のデータ契約
- `integrations.md` … Ollama / VOICEVOX / sd.cpp 連携の決定的契約(失敗時フォールバック含む)
- `popup.md` … 応援ポップアップの表示内容・表示時間・上書き・音声再生の決定的契約
- `main-window.md` … メインウィンドウの開閉ライフサイクル(キャラ未作成時の自動表示・トレイ開閉)
- `character-creation.md` … キャラ作成フォームの入力・検証・話者一覧・プロフィール保存

## 不変条件(全 spec に共通)

- **プライバシー**: キーの種類のみカウント。入力内容は保存・送信しない。通信は localhost のみ。
- **フォールバック**: 外部依存(Ollama/VOICEVOX/sd.cpp)が無くてもクラッシュしない。
- **再現性**: 乱数はシード固定可能。
