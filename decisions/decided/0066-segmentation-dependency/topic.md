# 論点 0066: 人物を切り抜くモデルと実行ライブラリの依存の審査

- **種別: 決定的**
- **状態: 決定済み**
- **反映先: `docs/licenses.md`・`docs/integrations.md`**(同梱物のライセンスの表と、置き場の要件)

## 何を決めるか

論点 0063 で背景を透明にするのを u2netp に替えた(人間の判断 2026-11-21)。新しい依存(モデルの重みと ONNX の実行ライブラリ)を入れるので、
出所・版・ライセンス・大きさ・置き場を審査して残す(`.claude/rules/security-rules.md`「依存・サプライチェーン」)。

## 案

| | 案A:onnxruntime-node + u2netp(採用) | 案B:onnxruntime-node + isnet-anime | 案C:rembg(Python)を同梱 |
| --- | --- | --- | --- |
| 大きさ | 重み 4.6 MB + 実行ライブラリ 約 32 MB | 重み 176 MB + 約 32 MB | Python の実行環境ごと(数百 MB) |
| 計測 | 論点 0063 で測った | 測っていない | — |
| 呼び方 | main から Node のネイティブ拡張で呼ぶ | 同左 | 子プロセス |

## 決定

**案A を採る**(人間の判断 2026-11-21:「u2netp 採用で」・置き場は「アプリ本体に入れる」)。

- 実行ライブラリ:npm の `onnxruntime-node` **1.31.1**(`package-lock.json` で固定)。使うのは Windows x64 の CPU の実行ファイル
  (`onnxruntime.dll` と `onnxruntime_binding.node`)だけ。GPU 用の `DirectML.dll`・`dxcompiler.dll` は配布物に入れない(CPU だけの方針)。
  インストール時のスクリプト(CUDA 版などを取りに行く)は動かさない。
- 重み:`u2netp.onnx`(rembg の配布物 `https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx`、4,574,861 バイト、
  sha256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`)。
- 置き場:アプリ本体(sd.cpp と同じく配布物の `resources/` の下)。重みの別ファイル(論点 0055)には入れない。開発機では取得の
  スクリプトで `vendor/` に置く(sd.cpp と同じ)。重みのパスは設定や入力から受け取らない。

## 理由

- 論点 0063 の計測で背景が安定した。大きさは配布物の約 2 GB(画像の重み)に比べて小さい。
- Node のネイティブ拡張(N-API)なので、Electron の main からそのまま呼べる。子プロセスや Python の実行環境が要らない。

## ライセンス(エージェントの読み。**配布の前に人間が原文で確かめる**)

- `onnxruntime-node`:MIT(npm の記載)。ONNX Runtime 本体(microsoft/onnxruntime)も MIT。
- u2netp の重み:U-2-Net(xuebinqin/U-2-Net)は Apache-2.0。ONNX への変換と配布は rembg(MIT)。
  重みそのもののライセンスの記載は確かめていない(リポジトリのライセンスが重みにも及ぶと読んでいる)。
- `onnxruntime-node` の推移的な依存(`global-agent`・`adm-zip` など)は、インストール時のスクリプト用。動かさないが、配布物に入るかは実装で確かめる。

## 却下した案

- 案B(isnet-anime)— 測っていない。大きさが約 40 倍。人間が小さいほうを選んだ。
- 案C(rembg を Python ごと同梱)— 実行環境が大きく、子プロセスと Python の同梱が増える。

## 決まらなかったこと(次の論点へ)

- 推移的な依存が配布物に入るか・入れてよいか(実装の作業で確かめ、問題があれば論点を開く)。
