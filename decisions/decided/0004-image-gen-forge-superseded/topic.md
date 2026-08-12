# 論点 0004: キャラ画像生成の手段(撤回済み)

- **種別: 決定的**
- **状態: 決定済み**
- **反映先: —(論点 0005 で置き換えた)**

> **ステータス: 撤回(Superseded by [0005](../0005-image-gen-sdcpp-lcm/topic.md))**

## 何を決めるか

キャラ画像を AI 生成したい。当初は高品質な SDXL ベースを想定していた。

## 決定

Forge + Illustrious XL を採用、Forge Portable を同梱。

## 却下した案

動作前提を「通常ノートPC / iGPU 環境でも動く」に明確化したため、
SDXL ベース(Illustrious XL、VRAM 8GB+ 要求)と Python ランタイム同梱の Forge は非現実的と判断。
→ 0005 で stable-diffusion.cpp + SD1.5 + LCM LoRA に置き換え。
