# 論点 0092: 同梱ランタイムの中に入っているライブラリのライセンスも、インストーラで示す

- **種別: 決定的**
- **状態: 決定済み**
- **反映先: `docs/licenses.md`**

## 何を決めるか

インストーラが示すライセンス(`docs/licenses.md` の表。論点 0043 / 0060)は、同梱物そのもの(Ollama・stable-diffusion.cpp・VOICEVOX ENGINE ほか)の単位で書いてある。
ところが同梱した公式の配布物には、別のライセンスのライブラリが DLL として入っていて、その著作権表示とライセンス文がどこにも無い。

| 同梱物 | 中に入っているもの(DLL) | ライセンス | 配布物に文書があるか |
| --- | --- | --- | --- |
| stable-diffusion.cpp(`master-1086-465adf3`) | ggml(`ggml*.dll`) | MIT | ある(`ggml.txt`。インストーラの文書には無い) |
| 同上 | libwebp(`libwebp.dll`・`libwebpmux.dll`・`libsharpyuv.dll`) | BSD-3-Clause | 無い |
| 同上 | libwebm(`webm.dll`) | BSD-3-Clause | 無い |
| Ollama 0.32.13 | llama.cpp・ggml(`libllama*.dll`・`libmtmd.dll`・`ggml*.dll`) | MIT | 無い |
| 同上 | LLVM の実行時ライブラリ(`libc++.dll`・`libunwind.dll`・`libomp.dll`) | Apache-2.0 WITH LLVM-exception | 無い |
| 同上 | MinGW-w64 の winpthreads(`libwinpthread-1.dll`) | MIT(と一部 BSD) | 無い |

VOICEVOX ENGINE は自前の一覧(`licenses.json`・各パッケージの LICENSE)を、Electron は `LICENSE.electron.txt` と `LICENSES.chromium.html` を、それぞれ配布物に入れているので対象外。
BSD-3 と MIT は、バイナリで配るときに著作権表示とライセンス文を添えることを求めている。

## 案

| | 案A:表に「同梱物の中のライブラリ」の行を足し、インストーラの文書に全文を入れる | 案B:ライセンス文をインストール先のフォルダに置くだけ |
|---|---|---|
| 利用者が読めるか | インストーラの同意の画面で読める(他のライセンスと同じ所) | インストール先を開けば読める |
| 今の決め方との整合 | 「ライセンスはインストーラの画面に示す」(論点 0060)と同じ | 示す場所が 2 つに分かれる |
| 文面の出所 | 各プロジェクトの公式リポジトリのライセンスの原文を、同梱した版に合わせて `assets/licenses/` に置く(取得物の出所とコミットを記録) | 同左 |

## 現在の考え

案A。docs の表に 1 行「同梱ランタイムの中のライブラリ(ggml / llama.cpp / libwebp / libwebm / LLVM の実行時ライブラリ / winpthreads)— 著作権表示とライセンス文」を足し、
シナリオは今の S0060_01(表の対象それぞれについて示すものが読める)のまま縛る(テストの期待する節を足す)。
ライセンスの読みはエージェントのもの。**配布の前に人間が原文で確かめる。**

## 決定

**案A。docs の表に「同梱ランタイムの中のライブラリ」の行を足し、インストーラの文書に著作権表示とライセンス文の全文を入れる**(人間の承認 2026-11-27)。
シナリオは S0060_01 のまま(表の対象それぞれについて示すものが読める)。文面は同梱した版に合わせ、各プロジェクトの公式リポジトリから取って `assets/licenses/` に置く:

| 文面 | 出所(リポジトリ・版) |
| --- | --- |
| ggml(sd.cpp 側)MIT | `leejet/ggml` `d803c238f67915fb825a9aa4df27b99356d51597`(sd.cpp `465adf3` の submodule。同梱の `ggml.txt` と改行以外は同じ) |
| libwebp BSD-3-Clause + PATENTS | `webmproject/libwebp` `0c9546f7efc61eac7f79ae115c3f99c91c21c443`(同上) |
| libwebm BSD-3-Clause + PATENTS | `webmproject/libwebm` `5bf12267eea773a32fcf4949de52b0add158a8d5`(同上) |
| llama.cpp・ggml(Ollama 側)MIT | `ggml-org/llama.cpp` `b10380`(Ollama v0.32.13 の `LLAMA_CPP_VERSION`) |
| libc++ / libunwind / OpenMP の Apache-2.0 WITH LLVM-exception | `llvm/llvm-project` `llvmorg-18.1.8`(Ollama v0.32.13 の release.yaml が使う llvm-mingw 20240619 の LLVM) |
| winpthreads | `mingw-w64/mingw-w64` `7c9cfe6708cafc83c14a2654308b2db62b126eae`(llvm-mingw 20240619 の mingw-w64) |

## 理由

- BSD-3 と MIT は、バイナリで配るときに著作権表示とライセンス文を添えることを求めている。今の配布物はそれを満たしていなかった。
- 「ライセンスはインストーラの画面に示す」(論点 0060)と同じ所に置けば、示す場所が 1 つで済む。

## 却下した案

- 案B(インストール先のフォルダに置くだけ)— 示す場所が 2 つに分かれる。

## 決まらなかったこと(次の論点へ)

- **静的に組み込まれたものは、この論点では扱っていない**(作業中に見つけた)。sd.cpp の `thirdparty/` の darts-clone・oniguruma・utf8proc・cpp-httplib・nlohmann/json・miniz・stb・zip、
  Ollama の Go のモジュール(`go.mod`)がそれにあたる。これらを示すかどうかは、配布の前に人間が確かめるときに決める(必要なら新しい論点を開く)。
- ライセンスの読みはエージェントのもの。**配布の前に人間が原文で確かめる。**
