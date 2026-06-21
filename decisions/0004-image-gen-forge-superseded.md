# ADR 0004: キャラ画像生成に SD WebUI Forge + Illustrious XL を採用 — Superseded(2026-05)

> **ステータス: 撤回(Superseded by [0005](./0005-image-gen-sdcpp-lcm.md))**

## 文脈

キャラ画像を AI 生成したい。当初は高品質な SDXL ベースを想定していた。

## 当初決定

Forge + Illustrious XL を採用、Forge Portable を同梱。

## 撤回理由

動作前提を「通常ノートPC / iGPU 環境でも動く」に明確化したため、
SDXL ベース(Illustrious XL、VRAM 8GB+ 要求)と Python ランタイム同梱の Forge は非現実的と判断。
→ 0005 で stable-diffusion.cpp + SD1.5 + LCM LoRA に置き換え。
