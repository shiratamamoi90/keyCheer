# ADR 0005: キャラ画像生成は stable-diffusion.cpp + SD1.5 + LCM LoRA(2026-05)

> Supersedes [0004](./0004-image-gen-forge-superseded.md)

## 文脈

動作前提が「通常ノートPC(iGPU/CPU 含む)でも動く」。SDXL 系・Python 同梱は非現実的。
キャラ画像生成はキャラ作成時の一度きりの機能で、常駐は不要。

## 決定

- ランナー: **stable-diffusion.cpp**(純C++、Python依存ゼロ、CLI 子プロセス呼び出し)。
- ベースモデル: **SD1.5 アニメ系**(AnythingV5 / MeinaMix / Counterfeit V3 等から実装時に確定)を同梱。
- 高速化: **LCM LoRA** 併用で 4 ステップ生成。
- **常駐させない**。キャラ設定の「AIで生成」ボタンで子プロセスを起動、通常/喜び/激励の3枚を生成して終了。
- ターゲット: iGPU(Vulkan で加速、ダメなら CPU フォールバック)。

## 結果

- 利点:
  - 通常ノートPC/iGPU でも動く(SDXL は VRAM 8GB+ で事実上不可)。
  - Python 不要で配布サイズ最小(ランタイム数十MB)。Electron から子プロセスで CLI を叩くだけ。
  - LCM 4 ステップで CPU でも数十秒/枚、3枚で 1〜2 分程度の見込み。
  - 失敗時は手動アップロードに誘導できる(一度きりの機能)。
- 欠点 / トレードオフ:
  - SD1.5 品質は SDXL に劣る(キャラ立ち絵としては実用範囲と判断)。
  - 子プロセスのライフサイクル管理(タイムアウト・キャンセル・ゾンビ防止・重複排他)が必要。

## 比較した選択肢

- ONNX Runtime + DirectML: iGPU 加速は強いが実装/配布が複雑。将来オプションとして余地あり。
- OpenVINO 版 SD: Intel iGPU 最速だが Intel 限定。
- Forge / A1111(CPU/DirectML): Python 同梱で配布サイズが巨大、セットアップ複雑(→ 0004 で撤回)。

## 未確定事項 [要確認]

- 同梱ベースモデルの最終選定(ライセンス/品質)、量子化(q4/q8)採用判断。
- iGPU 加速の確認方法と Vulkan 検出失敗時のフォールバック挙動。
- 表情差分の生成方式(同一シード+タグ差し替え / img2img)。
