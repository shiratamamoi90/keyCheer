// ui: メインウィンドウの見た目の部品(論点 0058)。振る舞いは持たない。色は styles/main.css の変数が決める。

import type * as ReactNS from "react";
import { buildImageSlots } from "./characterImagesView.js";
import type { CharacterListItem } from "../core/shared/ipc.js";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_CLASS = {
  primary: `${BUTTON_BASE} bg-accent text-on-accent hover:bg-accent/90`,
  secondary: `${BUTTON_BASE} border border-line bg-sunken text-fg hover:bg-line/60`,
  danger: `${BUTTON_BASE} border border-danger/40 text-danger hover:bg-danger-soft`,
} as const;

export const FIELD_BASE_CLASS =
  "rounded-lg border border-line bg-sunken px-3 py-2 text-fg placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60";
export const FIELD_CLASS = `${FIELD_BASE_CLASS} w-full`;

const MESSAGE_CLASS = {
  notice: "rounded-lg bg-warn-soft px-3 py-2 text-warn",
  error: "rounded-lg bg-danger-soft px-3 py-2 text-danger",
  info: "text-muted",
  ok: "rounded-lg bg-ok-soft px-3 py-2 text-ok",
} as const;
export type MessageKind = keyof typeof MESSAGE_CLASS;

type Children = { children?: ReactNS.ReactNode };

export function Button(
  props: {
    variant: keyof typeof BUTTON_CLASS;
    disabled?: boolean;
    onClick: () => void;
  } & Children,
): ReactNS.ReactElement {
  return (
    <button
      type="button"
      className={BUTTON_CLASS[props.variant]}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Message(props: { kind: MessageKind; text: string }): ReactNS.ReactElement {
  return <p className={`m-0 ${MESSAGE_CLASS[props.kind]}`}>{props.text}</p>;
}

export function Title(props: { text: string }): ReactNS.ReactElement {
  return <h1 className="m-0 text-xl font-semibold">{props.text}</h1>;
}

export function Card(
  props: { heading: ReactNS.ReactNode | null } & Children,
): ReactNS.ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
      {props.heading === null ? null : (
        <h2 className="m-0 text-base font-semibold">{props.heading}</h2>
      )}
      {props.children}
    </section>
  );
}

export function Field(props: { label: string } & Children): ReactNS.ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{props.label}</span>
      {props.children}
    </label>
  );
}

export function Actions(props: Children): ReactNS.ReactElement {
  return <div className="flex flex-wrap items-center gap-2">{props.children}</div>;
}

export function Pill(props: { text: string; isBusy?: boolean }): ReactNS.ReactElement {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
        props.isBusy === true ? "bg-sunken text-muted" : "bg-accent-soft text-accent"
      }`}
    >
      {props.text}
    </span>
  );
}

export function ProgressBar(props: { done: number; total: number }): ReactNS.ReactElement {
  return (
    <progress
      value={props.done}
      max={Math.max(props.total, 1)}
      className="h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-sunken [&::-webkit-progress-value]:bg-accent"
    />
  );
}

// 設定の 1 行(Windows 11 の設定画面のように、左に説明・右に切り替え)
export function SettingRows(props: Children): ReactNS.ReactElement {
  return <div className="flex flex-col divide-y divide-line">{props.children}</div>;
}

export function SettingRow(props: { label: string } & Children): ReactNS.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0 flex-1">{props.label}</span>
      {props.children}
    </div>
  );
}

export function ToggleSwitch(props: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): ReactNS.ReactElement {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-disabled:opacity-50" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

// 数の欄(論点 0070)。打っている間は下書きだけを持ち、欄から離れる・Enter で確定する。
// 確定した値(値域に寄せた後)を欄に出し直す
export function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (input: string) => number;
}): ReactNS.ReactElement {
  const [draft, setDraft] = React.useState(String(props.value));
  React.useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = (): void => setDraft(String(props.onCommit(draft)));
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={props.label}
      className={`${FIELD_BASE_CLASS} w-28 shrink-0 text-right`}
      value={draft}
      min={props.min}
      max={props.max}
      step={1}
      disabled={props.disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

export function thumbnailOf(item: CharacterListItem | undefined): string | null {
  if (item === undefined) return null;
  return buildImageSlots(item.images).find((image) => image.kind === "idle")?.url ?? null;
}

// 一覧の 1 件(キャラクター画面・切り替え画面)。待機画像があれば小さく出す
export function CharacterCard(props: {
  name: string;
  meta: string | null;
  pills: ReactNS.ReactNode;
  thumbnailUrl: string | null;
  isSelected: boolean;
  isDimmed?: boolean;
  onClick: () => void;
}): ReactNS.ReactElement {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.isSelected}
      onClick={props.onClick}
      className={`flex w-full items-center gap-3 rounded-card border bg-surface p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
        props.isSelected ? "border-accent ring-1 ring-accent" : "border-line hover:border-muted/50"
      } ${props.isDimmed === true ? "opacity-70" : ""}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-sunken font-semibold text-accent">
        {props.thumbnailUrl === null ? (
          (Array.from(props.name)[0] ?? "")
        ) : (
          <img
            src={props.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover object-top [image-rendering:pixelated]"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{props.name}</span>
        {props.meta === null ? null : <span className="text-xs text-muted">{props.meta}</span>}
      </span>
      {props.pills === null ? null : (
        <span className="ml-auto flex flex-wrap gap-1">{props.pills}</span>
      )}
    </button>
  );
}

export function CharacterList(props: { label: string } & Children): ReactNS.ReactElement {
  return (
    <div role="listbox" aria-label={props.label} className="flex flex-col gap-2">
      {props.children}
    </div>
  );
}

// 一覧と、その横の面(S0050_01 一覧の横に 3 枚)
export function TwoColumns(props: Children): ReactNS.ReactElement {
  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-4">{props.children}</div>
  );
}

// 使用中・生成中の印。どちらでもなければ null(一覧の 1 件に印の枠を出さない)
export function statusPills(isActive: boolean, isGenerating: boolean): ReactNS.ReactNode {
  if (!isActive && !isGenerating) return null;
  return (
    <>
      {isActive ? <Pill text="使用中" /> : null}
      {isGenerating ? <Pill text="生成中" isBusy /> : null}
    </>
  );
}
