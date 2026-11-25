// imagePanel: キャラクターの 3 枚と「画像だけ作り直す」(論点 0050)。
// S0050_01 / S0050_03 3 枚を並べる(透明が分かる下地。欠けたら欠けていると示す)
// S0050_06 / S0050_07 「画像だけ作り直す」と、使えないときの理由

import type * as ReactNS from "react";
import { buildImageSlots, resolveImageRegeneration } from "./characterImagesView.js";
import type { CharacterListItem, ImageRegenerationProgressPayload } from "../core/shared/ipc.js";
import { Actions, Button, Card, Message, ProgressBar } from "./ui.js";

const IMAGE_REGENERATION_FAILURE_TEXT: Record<
  "already-running" | "no-character" | "no-pool" | "runtime-not-installed",
  string
> = {
  "already-running": "生成中です。終わってから作り直せます",
  "no-character": "キャラクターが見つかりません",
  "no-pool": "まだ生成していないキャラクターです",
  "runtime-not-installed": "画像生成のモデルの重みがありません。インストーラで入れ直してください",
};
const IMAGE_REGENERATION_RESULT_TEXT: Record<"images-failed" | "cancelled", string> = {
  "images-failed": "画像を作れませんでした。前の画像のままです",
  cancelled: "作り直しを中断しました。前の画像のままです",
};

// 画像だけ作り直すの状態(どの画面の 3 枚からでも同じものを見る)。進捗は main から届く。終わったら一覧を読み直す
export function useImageRegeneration(refreshCharacters: () => void) {
  const [canMakeImages, setCanMakeImages] = React.useState(false);
  const [progress, setProgress] = React.useState<ImageRegenerationProgressPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    void window.keycheer.canMakeImages().then(setCanMakeImages);
    return window.keycheer.onImageRegenerationProgress((payload) => {
      setProgress(payload);
      if (payload.type !== "progress") refreshCharacters();
    });
  }, [refreshCharacters]);

  const start = (characterId: string): void => {
    setError(null);
    void window.keycheer.regenerateImages(characterId).then((result) => {
      if (result.ok) {
        setProgress({ type: "progress", characterId, done: 0, total: 3 });
      } else {
        setError(IMAGE_REGENERATION_FAILURE_TEXT[result.reason]);
      }
    });
  };
  const refreshCanMakeImages = (): void => {
    void window.keycheer.canMakeImages().then(setCanMakeImages);
  };
  return { canMakeImages, progress, error, start, refreshCanMakeImages };
}

export type ImageRegeneration = ReturnType<typeof useImageRegeneration>;

export function ImagePanel(props: {
  item: CharacterListItem;
  regeneration: ImageRegeneration;
  isAnythingRunning: boolean;
  leadingAction?: ReactNS.ReactNode;
}): ReactNS.ReactElement {
  const { item, regeneration } = props;
  const availability = resolveImageRegeneration({
    canMakeImages: regeneration.canMakeImages,
    isRunning: props.isAnythingRunning,
  });
  const regen = regeneration.progress?.characterId === item.id ? regeneration.progress : null;
  const isRegenerating = regen?.type === "progress";
  return (
    <Card
      heading={
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {item.name}
          <span className="text-xs font-normal text-muted">作った画像(市松模様は透明な部分)</span>
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        {buildImageSlots(item.images).map((image) => (
          <figure key={image.kind} className="m-0 flex min-w-0 flex-col gap-1.5">
            <div className="checkerboard grid aspect-[2/3] max-w-full place-items-center overflow-hidden rounded-lg border border-line">
              {image.url === null ? (
                <span className="p-2 text-center text-xs text-danger">画像がありません</span>
              ) : (
                <img
                  src={image.url}
                  alt={image.label}
                  className="h-full w-full object-contain [image-rendering:pixelated]"
                />
              )}
            </div>
            <figcaption className="text-center text-xs text-muted">{image.label}</figcaption>
          </figure>
        ))}
      </div>
      {regen?.type === "progress" ? <ProgressBar done={regen.done} total={regen.total} /> : null}
      <Actions>
        {props.leadingAction ?? null}
        <Button
          variant="secondary"
          disabled={!availability.isEnabled}
          onClick={() => regeneration.start(item.id)}
        >
          画像だけ作り直す
        </Button>
        {isRegenerating ? (
          <Button variant="secondary" onClick={() => void window.keycheer.cancelGeneration()}>
            中断
          </Button>
        ) : null}
      </Actions>
      {availability.notice !== null && !isRegenerating ? (
        <Message kind="notice" text={availability.notice} />
      ) : null}
      {regen === null ? null : regen.type === "progress" ? (
        <Message kind="info" text={`画像を作り直しています… ${regen.done} / ${regen.total}`} />
      ) : regen.type === "done" ? (
        <Message kind="info" text="画像を作り直しました" />
      ) : (
        <Message kind="error" text={IMAGE_REGENERATION_RESULT_TEXT[regen.reason]} />
      )}
      {regeneration.error !== null ? <Message kind="error" text={regeneration.error} /> : null}
    </Card>
  );
}
