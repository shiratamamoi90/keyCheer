# 要件: 応援ポップアップの表示(発動 → 表示 → 自動クローズ)

発動条件を満たしたとき、main から届く `CheerFiredPayload` だけでポップアップの表示内容が決まり、
一定時間で消える。renderer は core / providers / Node に触れない。

見た目・アニメーションの良し悪しは本 spec の対象外(デザイン判断であり、決定的な受け入れ条件にしない)。
表示内容は決定的に縛るが、表示の見た目は縛らない。詳細な経緯は `work(削除済み)/0007-runnable-popup-slice/`。

`CheerFiredPayload` のデータ契約は `docs/data-model.md`、発動条件そのものは `docs/cheer-trigger.md` 参照。

## 確定事項

| # | 論点 | 確定 |
| - | ---- | ---- |
| 1 | ビルド構成 | バンドルしない。`tsc` 出力 + 素の HTML/JS |
| 2 | ポップアップ renderer の FW | 素の TS(React は使わない) |
| 3 | 表示中に次の発動 | 上書き + 表示時間リセット(キューに積まない) |
| 4 | 音声再生の主体 | renderer の `Audio`。`file://` は直接読まず、main が登録する専用スキーム経由 |
| 5 | 表示時間 | `popupDurationMs`(設定化は設定 UI の change で) |

補足:ポップアップに描画する文字は `message` のみ(画像は下の「キャラ画像の常時表示と切り替え」)。`count` / `kpm` / `speedZone` はペイロードに含まれるが描画しない。
`wavPath` は使用中のキャラクターの wav があるときだけ入り、無いとき(使用中が無い・音声が全滅した等)は null で音声を再生しない。

### S0017_01 発動でポップアップが表示される

- GIVEN ポップアップウィンドウが生成済み(非表示)
- WHEN main が `IpcChannel.CheerFired` で `CheerFiredPayload` を送る
- THEN ポップアップが表示され、`message` の文字列が描画される

### S0017_02 表示時間が過ぎたら消える [境界]

- GIVEN `popupDurationMs = 5000` のペイロードを表示開始した
- WHEN 表示開始からの経過時間が 5000ms に達する
- THEN 非表示になる(表示中の条件は `経過 < popupDurationMs` の strict less-than。
  `key-counter.md` の「閾値ちょうどは非アクティブ」と同じ向きに揃える)

### S0017_03 表示中に次の発動が来たら上書きする

- GIVEN 文言 A を表示中(残り 2000ms)
- WHEN 文言 B の `CheerFired` が届く
- THEN 表示は B に差し替わり、残り時間は `popupDurationMs` にリセットされる(A はキューに残さない)

### S0017_04 wav がある発動で音声も再生する

- GIVEN `wavPath` が非 null のペイロード
- WHEN ポップアップを表示する
- THEN その wav を 1 回だけ再生する(`file://` を直接開かず、main が登録した専用スキーム経由で読む)

### S0017_05 wav が無い発動はテキストのみ [異常系]

- GIVEN `wavPath` が null のペイロード(baseline 定型文 / wav 欠損)
- WHEN ポップアップを表示する
- THEN 音声を再生せず、テキストのみ表示してクラッシュしない

### S0017_06 ポップアップは入力の邪魔をしない [不変条件]

- GIVEN 打鍵中にポップアップが表示される
- WHEN ユーザーがタイピングを続ける
- THEN フォーカスを奪わず、クリックも透過する(`focusable: false` / `setIgnoreMouseEvents(true)` / `skipTaskbar: true` を維持)

### S0017_07 preload が公開する API は最小 [不変条件]

- GIVEN renderer から公開 API を列挙する
- WHEN その形を検査する
- THEN 発動イベントの購読・設定取得/更新・統計取得だけが存在し、Node / Electron のオブジェクト
  (`require` / `ipcRenderer` / `fs` 等)は一切露出しない(`contextIsolation: true`, `nodeIntegration: false`)

### S0017_08 renderer は core / providers を import しない [不変条件]

- GIVEN renderer / preload のソース
- WHEN import を検査する
- THEN `src/core/providers/*`・`src/agent/*` の生成系を import しない
  (表示に必要な型は `src/core/shared` からのみ取る。ESLint の no-restricted-imports で機械的に止める)

### S0017_09 入力内容は renderer に渡らない [不変条件]

- GIVEN 任意の発動
- WHEN renderer が受け取るペイロードを検査する
- THEN キーコード・入力文字・キーシーケンスは含まれない(集計値と表示文言のみ)

### S0017_10 renderer の読み込みに失敗した場合 [異常系]

- GIVEN ポップアップ用 HTML の読み込みに失敗する
- WHEN 発動が起きる
- THEN アプリは落ちず、キーカウント・統計の記録は継続する(表示だけが失われる)。
  main 側にエラーログを残すのみで、ユーザーへの通知は行わない

## 要件: キャラ画像の常時表示と切り替え(論点 0036)

**常時表示**(`popup.shouldAlwaysShow`、既定 `true`)のとき、キャラの窓を常に画面に出し、使用中のキャラクターの
**待機画像**を表示する。応援が出たらその応援種別の画像に切り替え、表示時間が過ぎたら待機画像に戻す。
常時表示を切ったときは、ここまでの S0017 のとおり発動時だけ文言を出す。
窓の形・大きさ・位置は見た目なので縛らない(縦長で 256x384 の画像がおさまること)。

### S0036_18 常時表示なら待機画像を出し続ける

- GIVEN `popup.shouldAlwaysShow = true`、使用中のキャラクターに待機画像がある
- WHEN アプリを起動し、応援が出ていない
- THEN キャラの窓が表示され、待機画像が描画される。文言は描画しない

### S0036_19 応援でその応援種別の画像に切り替え、表示時間の後に待機画像へ戻す

- GIVEN 常時表示で待機画像を表示中、使用中のキャラクターに `milestone` の画像がある
- WHEN `milestone` の応援が発動する
- THEN 文言とともに `milestone` の画像を描画する。`popupDurationMs` が過ぎたら文言を消して待機画像に戻し、**窓は消さない**

### S0036_20 その応援種別の画像が無ければ待機画像を出す [異常系]

- GIVEN 常時表示、使用中のキャラクターに待機画像はあるが `regular` の画像が無い
- WHEN `regular` の応援が発動する
- THEN 文言とともに待機画像を描画し、クラッシュしない

### S0036_21 待機画像も無ければ画像を出さない [異常系]

- GIVEN 常時表示、使用中のキャラクターが無い、または待機画像が無い
- WHEN 応援が出ていない間 / 応援が発動したとき
- THEN 画像を描画しない。応援の文言と音声は S0017 のとおり出す。クラッシュしない

### S0036_22 定型文の応援では待機画像を出す [境界]

- GIVEN 常時表示、使用中のキャラクターに待機画像はあるがプールが無い(baseline 定型文で応援する)
- WHEN 応援が発動する
- THEN 文言とともに待機画像を描画する

### S0036_23 使用中のキャラクターを切り替えたら待機画像も切り替わる

- GIVEN 常時表示で、使用中のキャラクター C の待機画像を表示中
- WHEN 使用中を D に切り替える
- THEN 再起動しなくても D の待機画像に切り替わる(D に待機画像が無ければ S0036_21)

### S0036_24 常時表示を切ると発動時だけ文言を出す [否定]

- GIVEN `popup.shouldAlwaysShow = false`、使用中のキャラクターに画像がある
- WHEN 応援が出ていない間 / 応援が発動したとき
- THEN 応援が出ていない間は窓を出さない。発動時は S0017_01〜05 のとおり文言(と音声)だけを出し、**画像は描画しない**

### S0036_25 常時表示の窓も入力の邪魔をしない [不変条件]

- GIVEN 常時表示でキャラの窓が出ている
- WHEN ユーザーがタイピング・クリックを続ける
- THEN フォーカスを奪わず、クリックも透過する(S0017_06 と同じ設定を常時表示中も維持する)

### S0036_26 応援の発動で画像を作らない [否定]

- GIVEN 画像が欠けているキャラクター、画像プロバイダーの設定が何であれ
- WHEN 応援が発動する
- THEN 画像プロバイダー(sd.cpp / 外部 API)を呼ばず、子プロセスも起動しない。読むのは保存済みの画像だけ
  (画像は `wav` と同じく main が登録した専用スキーム経由で読み、`file://` を直接開かない)

## 不変条件

- renderer / preload は core を**使う側**。core は両者に依存しない。
- 発動経路(main → preload → renderer)に providers 設定・プロバイダー実装を持ち込まない。
- `contextIsolation: true` / `nodeIntegration: false` を維持する(最小権限)。
- ポップアップに渡すのは `CheerFiredPayload` のみ。入力内容は含めない。
- 表示の**内容**は決定的に縛る。表示の**見た目**は縛らない。
