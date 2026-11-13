# image-eval: 画像のベースモデルの計測(論点 0041)で sd.cpp を動かすための開発機用コンテナ。
#
# なぜコンテナか:公式の Linux 向け配布物は Ubuntu 26.04 でビルドされていて GLIBC 2.43 を要求する。
# 開発機(Ubuntu 24.04・GLIBC 2.39)ではそのまま動かない。配布物を作り直さず、同じ OS の上で動かす。
# 製品(Windows 向け CPU 版)には関係しない。計測ドライバ(src/eval)だけが使う。
#
# 足すのは sd.cpp が要る OpenMP のランタイムと、最大メモリを測る time だけ。
# ベースは digest で固定する(論点 0023 と同じ)。apt のパッケージは版を固定できないので、
# 入った版は result.md に書く。
FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 time \
  && rm -rf /var/lib/apt/lists/*
