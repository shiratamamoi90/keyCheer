// Tailwind の設定(論点 0058 / 0079)。メインウィンドウ(main.css)とキャラの窓(popup.css)の両方が使う。
// キャラの窓は下の色の変数(ライト / ダーク)を使わず、決まった色だけを使う(S0057_05)。
// 色は src/renderer/styles/main.css の CSS 変数を参照する。ライトとダーク(論点 0057)は変数の差し替えだけで切り替わるので、
// 画面側に dark: を並べなくてよい。<html class="dark"> は renderer/theme.ts の呼び出し側が付ける。
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        sunken: token("sunken"),
        line: token("line"),
        fg: token("fg"),
        muted: token("muted"),
        accent: token("accent"),
        "accent-soft": token("accent-soft"),
        "on-accent": token("on-accent"),
        warn: token("warn"),
        "warn-soft": token("warn-soft"),
        danger: token("danger"),
        "danger-soft": token("danger-soft"),
        ok: token("ok"),
        "ok-soft": token("ok-soft"),
      },
      fontFamily: {
        // CSP で font-src を許していないため Web フォントは使わず OS のフォントだけに頼る(論点 0058 決定 2)
        ui: [
          '"Yu Gothic UI"',
          '"Segoe UI"',
          "Meiryo",
          '"Noto Sans JP"',
          '"Noto Sans CJK JP"',
          '"Hiragino Sans"',
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: { card: "10px" },
      boxShadow: { card: "var(--shadow-card)" },
    },
  },
  plugins: [],
};
