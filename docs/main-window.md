# 要件: メインウィンドウの開閉(キャラクター未作成時の自動表示 + トレイからの開閉)

キャラクターが未作成のとき、起動時にメインウィンドウ(将来キャラ作成 UI を載せる場所)を自動表示する。
キャラクター作成済み、または自動表示をユーザーがスキップ済みのときは自動表示しない。
トレイから手動でも開閉(トグル)できる。ウィンドウを閉じても常駐は継続する(プロセスは終了しない)。

メインウィンドウの**中身**(キャラ作成フォーム等)は本 spec の対象外。本 spec が縛るのは
「いつ表示/非表示になるか」というライフサイクルのみ。詳細は `論点 0018(`decisions/decided/0018-main-window/`)`。

`hasCharacter` の判定・`onboarding.skipMainWindowAutoShow` のデータ契約は `docs/data-model.md` 参照。

### S0018_01 キャラクター未作成なら起動時にメインウィンドウを表示する

- GIVEN `hasCharacter(character) === false` かつ `onboarding.skipMainWindowAutoShow === false`
- WHEN アプリを起動する
- THEN メインウィンドウが自動的に表示される

### S0018_02 キャラクター作成済みなら起動時にメインウィンドウを表示しない

- GIVEN `hasCharacter(character) === true`
- WHEN アプリを起動する
- THEN メインウィンドウは生成されるが非表示のまま(トレイ操作でのみ表示される)

### S0018_03 スキップ済みなら未作成でも起動時に表示しない

- GIVEN `hasCharacter(character) === false` かつ `onboarding.skipMainWindowAutoShow === true`
- WHEN アプリを起動する
- THEN メインウィンドウは生成されるが自動表示しない(トレイからは引き続き開ける)

### S0018_04 トレイクリックで表示/非表示をトグルする

- GIVEN メインウィンドウが非表示状態
- WHEN トレイの「KeyCheer を開く」をクリックする
- THEN メインウィンドウが表示され、フォーカスされる
- GIVEN メインウィンドウが表示中に同操作を行う
- WHEN トレイをクリックする
- THEN 非表示になる(hide。ダイアログは経由しない)

### S0018_05 作成済みなら閉じてもダイアログを出さない

- GIVEN `hasCharacter(character) === true` の状態でメインウィンドウが表示中
- WHEN 閉じるボタン(×)を押す
- THEN 確認ダイアログを出さず、即座に hide する(`app.quit()` は呼ばれない)

### S0018_06 未作成のまま閉じるとダイアログが出る

- GIVEN `hasCharacter(character) === false` の状態でメインウィンドウが表示中
- WHEN 閉じるボタン(×)を押す
- THEN 「次回から自動表示しない」チェックボックス付きの確認ダイアログを表示する
  (`close` イベントの既定動作を止めてから非同期で確認する)

### S0018_07 ダイアログの選択でスキップフラグが決まる

- GIVEN 上記ダイアログが表示されている
- WHEN チェックボックスを**チェックせず** OK を選ぶ
- THEN ウィンドウは hide され、`onboarding.skipMainWindowAutoShow` は変更しない
- GIVEN 上記ダイアログが表示されている
- WHEN チェックボックスを**チェックして** OK を選ぶ
- THEN ウィンドウは hide され、`onboarding.skipMainWindowAutoShow` を `true` として永続化する

### S0018_08 スキップ済みでもトレイからは開ける

- GIVEN `onboarding.skipMainWindowAutoShow === true` かつ `hasCharacter(character) === false`
- WHEN トレイの「KeyCheer を開く」をクリックする
- THEN メインウィンドウが表示される(スキップは自動表示のみを抑制し、手動オープンには影響しない)

### S0018_09 重複表示の防止 [境界]

- GIVEN メインウィンドウの表示要求(起動時自動表示・トレイクリック)が短時間に重複する
- WHEN 2 回目以降の表示要求が発生する
- THEN 新しいウィンドウを二重生成せず、既存の 1 つを表示・フォーカスするだけに留める

### S0018_10 メインウィンドウの読み込みに失敗した場合 [異常系]

- GIVEN メインウィンドウ用 HTML の読み込みに失敗する
- WHEN 起動時の自動表示 or トレイクリックが発生する
- THEN アプリは落ちず、発動経路(キー押下 → ポップアップ)は影響を受けない。
  main 側にエラーログを残すのみとする

### S0018_11 メインウィンドウは発動経路と独立している [不変条件]

- GIVEN メインウィンドウの表示/非表示状態(任意)
- WHEN キー押下がトリガー条件を満たす
- THEN メインウィンドウの状態に関係なくポップアップが発動する(相互に依存しない)

### S0018_12 メインウィンドウの renderer は providers を import しない [不変条件]

- GIVEN メインウィンドウ用 preload / renderer のソース
- WHEN import を検査する
- THEN `src/agent/*`・`src/core/providers/*` を import しない(ESLint no-restricted-imports で機械的に検査)

## 不変条件

- 常駐アプリ:メインウィンドウを閉じても `app.quit()` しない。
- 発動経路(キー押下 → ポップアップ)とメインウィンドウのライフサイクルは独立。
- `hasCharacter` はメモリ上の設定オブジェクトから決定的に計算する純粋関数(I/O を持たない)。
- `onboarding.skipMainWindowAutoShow` は自動表示のみを抑制する。トレイからの手動オープンには影響しない。
- メインウィンドウの中身(キャラ作成 UI 本体)は本 spec のスコープ外。
