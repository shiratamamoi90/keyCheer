// characterScreen: キャラクター画面(保存・編集・削除と生成。論点 0061)。
// 検証は characterForm.ts、生成の見せ方は generationView.ts、画面の状態遷移は mainScreen.ts(どれも純粋関数でテスト済み)。
// ここは DOM と IPC の配線だけ。入力の状態は画面を切り替えても残すため、アプリの根(mainEntry)が useCharacterEditor を持つ。

import type * as ReactNS from "react";
import {
  buildSpeakerCreditNotice,
  resolveEditableSpeakerId,
} from "../core/shared/selectableSpeaker.js";
import type { CharacterListItem, SpeakerOption } from "../core/shared/ipc.js";
import {
  CHARACTER_NAME_MAX,
  CHARACTER_PERSONALITY_MAX,
  toCharacterProfile,
  validateCharacterForm,
  type CharacterFormError,
} from "./characterForm.js";
import {
  progressLabel,
  REBUILD_CONFIRMATION_TEXT,
  resolveGenerateButton,
  shouldConfirmRebuild,
  START_GENERATION_LABEL,
} from "./generationView.js";
import {
  buildGenerationHeading,
  canShowGenerationControls,
  generationTabBadge,
  type MainScreenEvent,
  type MainScreenState,
} from "./mainScreen.js";
import { canShowGeneratedImages } from "./characterImagesView.js";
import { ImagePanel, type ImageRegeneration } from "./imagePanel.js";
import {
  Actions,
  Button,
  Card,
  CharacterCard,
  CharacterList,
  FIELD_CLASS,
  Field,
  Message,
  ProgressBar,
  statusPills,
  thumbnailOf,
  Title,
  TwoColumns,
  type MessageKind,
} from "./ui.js";

const ERROR_TEXT: Record<string, string> = {
  "name:required": "名前を入力してください",
  "name:too-long": `名前は ${CHARACTER_NAME_MAX} 文字以内で入力してください`,
  "personality:required": "性格を入力してください",
  "personality:too-long": `性格は ${CHARACTER_PERSONALITY_MAX} 文字以内で入力してください`,
  "speakerId:required": "話者を選択してください",
};

const DELETE_FAILURE_TEXT: Record<string, string> = {
  generating: "生成中のキャラクターは削除できません",
  "remove-failed": "生成物を削除できませんでした。開いているファイルを閉じてからやり直してください",
  "not-found": "キャラクターが見つかりません",
};

function errorText(error: CharacterFormError): string {
  return ERROR_TEXT[`${error.field}:${error.reason}`] ?? "入力を確認してください";
}

export function useCharacterEditor(deps: {
  state: MainScreenState;
  dispatch: (event: MainScreenEvent) => void;
  refreshCharacters: () => void;
  setStatus: (status: string | null) => void;
}) {
  const { state, dispatch, refreshCharacters, setStatus } = deps;
  // 編集中のキャラクター(null = 新規)と入力
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [personality, setPersonality] = React.useState("");
  const [speakerId, setSpeakerId] = React.useState<number | null>(null);
  const [speakers, setSpeakers] = React.useState<SpeakerOption[]>([]);
  const [speakersUnavailable, setSpeakersUnavailable] = React.useState(false);
  const [errors, setErrors] = React.useState<CharacterFormError[]>([]);
  const [blocked, setBlocked] = React.useState<string | null>(null);
  // 作り直しの確認を出しているキャラクター(論点 0038。null = 出していない)
  const [rebuildConfirmId, setRebuildConfirmId] = React.useState<string | null>(null);
  // 確認したキャラクター。呼び直すときに確認済みとして渡す
  const confirmedRebuildIdRef = React.useRef<string | null>(null);

  // シナリオ: 話者一覧を VOICEVOX から取得する / VOICEVOX 未起動でも画面は壊れない [異常系]
  React.useEffect(() => {
    void window.keycheer.getSpeakers().then((result) => {
      if (result.ok) {
        setSpeakers(result.speakers);
      } else {
        setSpeakersUnavailable(true);
      }
    });
  }, []);

  const fillForm = (editing: CharacterListItem | undefined): void => {
    setEditingId(editing?.id ?? null);
    setName(editing?.name ?? "");
    setPersonality(editing?.personality ?? "");
    // S0044_06 今の話者が選べる話者に無ければ未選択として出す(選び直すまで保存できない)
    setSpeakerId(resolveEditableSpeakerId(editing?.voicevoxSpeakerId ?? null));
    setErrors([]);
    setStatus(null);
  };

  const edit = (characterId: string | null): void => {
    fillForm(state.items.find((c) => c.id === characterId));
  };

  const startGeneration = (characterId: string): void => {
    setBlocked(null);
    const isRebuildConfirmed = confirmedRebuildIdRef.current === characterId;
    void window.keycheer.startGeneration(characterId, { isRebuildConfirmed }).then((result) => {
      if (result.ok) {
        confirmedRebuildIdRef.current = null;
        dispatch({ type: "generation-started", characterId }); // S0061_06 進捗と結果の持ち主
        refreshCharacters(); // 一覧に生成中を出す(S0033_11)
        return;
      }
      // S0038_07 作り直しになるときは、生成を始める前に確認する
      if (shouldConfirmRebuild(result)) {
        setRebuildConfirmId(characterId);
        return;
      }
      dispatch({ type: "generation", payload: { type: "failed", reason: result.reason } });
    });
  };

  // S0038_07 作り直すを選んだときだけ、確認済みとして呼び直す
  const confirmRebuild = (): void => {
    if (rebuildConfirmId === null) return;
    confirmedRebuildIdRef.current = rebuildConfirmId;
    const characterId = rebuildConfirmId;
    setRebuildConfirmId(null);
    startGeneration(characterId);
  };

  // S0038_08 確認で取りやめたら何も変えない — 呼び直さないだけ(main は確認を求めた時点で何も書いていない)
  const cancelRebuild = (): void => {
    confirmedRebuildIdRef.current = null;
    setRebuildConfirmId(null);
  };

  const submit = (): void => {
    const input = { name, personality, speakerId };
    const validation = validateCharacterForm(input);
    setErrors(validation.errors);
    setStatus(null);
    if (!validation.ok) return;

    const profile = toCharacterProfile(input);
    const request = editingId !== null ? { ...profile, id: editingId } : profile;
    void window.keycheer.saveCharacter(request).then((result) => {
      // シナリオ: 保存に失敗した場合 [異常系] — 失敗を伝えるだけで画面は壊さない
      if (!result.ok) {
        setStatus(
          result.errors.includes("character limit reached")
            ? "保存できるのは 10 件までです"
            : "保存できませんでした",
        );
        return;
      }
      // 保存したキャラクターを選んだままにする。そのまま生成ボタンを押せる(論点 0061 S0061_02)。
      // 新規は応答に id が無いので、読み直した一覧で前に無かったものを選ぶ
      const knownIds = new Set(state.items.map((c) => c.id));
      void window.keycheer.listCharacters().then((items) => {
        dispatch({ type: "characters-loaded", items });
        fillForm(
          editingId !== null
            ? items.find((c) => c.id === editingId)
            : items.find((c) => !knownIds.has(c.id)),
        );
        setStatus("保存しました");
      });
      refreshCharacters();
    });
  };

  const remove = (): void => {
    if (editingId === null) return;
    void window.keycheer.deleteCharacter(editingId).then((result) => {
      if (!result.ok) {
        setStatus(DELETE_FAILURE_TEXT[result.reason] ?? "削除できませんでした");
        return;
      }
      edit(null);
      setStatus("削除しました");
      refreshCharacters();
    });
  };

  return {
    editingId,
    name,
    setName,
    personality,
    setPersonality,
    speakerId,
    setSpeakerId,
    speakers,
    speakersUnavailable,
    errors,
    blocked,
    rebuildConfirmId,
    edit,
    submit,
    remove,
    startGeneration,
    confirmRebuild,
    cancelRebuild,
  };
}

export type CharacterEditor = ReturnType<typeof useCharacterEditor>;

// 入力の枠(保存・編集・削除と、生成ボタン。論点 0061)
function FormCard(props: {
  editor: CharacterEditor;
  state: MainScreenState;
  status: string | null;
}): ReactNS.ReactElement {
  const { editor, state } = props;
  const editingItem = state.items.find((c) => c.id === editor.editingId) ?? null;
  const generateButton = resolveGenerateButton({
    generation: state.generation,
    editing: editingItem,
    form: { name: editor.name, personality: editor.personality, speakerId: editor.speakerId },
  });
  // S0043_03 選んだ話者のクレジット表記(論点 0043 / 0060。アプリの中に残す表記はここだけ)
  const credit = editor.speakersUnavailable ? null : buildSpeakerCreditNotice(editor.speakerId);
  return (
    <Card heading={editor.editingId === null ? "新しいキャラクター" : "キャラクターを編集"}>
      <Field label="名前">
        <input
          className={FIELD_CLASS}
          value={editor.name}
          onChange={(e) => editor.setName(e.target.value)}
        />
      </Field>
      <Field label="性格">
        <textarea
          className={`${FIELD_CLASS} resize-y`}
          value={editor.personality}
          rows={4}
          onChange={(e) => editor.setPersonality(e.target.value)}
        />
      </Field>
      <Field label="話者">
        {editor.speakersUnavailable ? (
          <Message
            kind="notice"
            text="VOICEVOX に接続できません。起動してから画面を開き直してください。"
          />
        ) : (
          <select
            className={FIELD_CLASS}
            value={editor.speakerId ?? ""}
            onChange={(e) =>
              editor.setSpeakerId(e.target.value === "" ? null : Number(e.target.value))
            }
          >
            <option value="">選択してください</option>
            {editor.speakers.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.name}(${s.styleName})`}
              </option>
            ))}
          </select>
        )}
      </Field>
      {credit === null ? null : <p className="m-0 text-sm text-muted">{credit}</p>}
      {editor.errors.map((e) => (
        <Message key={`${e.field}:${e.reason}`} kind="error" text={errorText(e)} />
      ))}
      {editingItem?.hasProfileChanged === true ? (
        <Message
          kind="notice"
          text="生成した後にプロフィールを変更しています。生成すると新しいプロフィールで作り直します。"
        />
      ) : null}
      <Actions>
        <Button variant="secondary" onClick={editor.submit}>
          保存
        </Button>
        {/* S0061_02〜04 保存済みで入力が保存した内容と同じときだけ押せる。生成中は押せない(論点 0020) */}
        <Button
          variant="primary"
          disabled={!generateButton.isEnabled}
          onClick={() => {
            if (editor.editingId !== null) editor.startGeneration(editor.editingId);
          }}
        >
          {START_GENERATION_LABEL}
        </Button>
        {editor.editingId !== null ? (
          <Button variant="danger" onClick={editor.remove}>
            削除
          </Button>
        ) : null}
      </Actions>
      {generateButton.notice !== null ? <Message kind="info" text={generateButton.notice} /> : null}
      {props.status !== null ? <Message kind="info" text={props.status} /> : null}
    </Card>
  );
}

// S0061_05 生成の進捗と結果を入力の枠の下に出す / S0061_06 生成しているキャラクターの名前を示す
// S0033_08 進捗と中断はこの画面だけに出す
function GenerationCard(props: {
  state: MainScreenState;
  blocked: string | null;
}): ReactNS.ReactElement | null {
  const { state } = props;
  const generationHeading = buildGenerationHeading(state);
  const label = progressLabel(state.generation);
  if (props.blocked === null && (generationHeading === null || label === "")) return null;
  const isRunning = generationTabBadge(state.generation) !== null;
  const isFailed = state.generation.phase === "failed";
  // 画像が欠けても生成は完了だが、欠けたことは目立たせる(S0036_09 / S0036_10)
  const images = state.generation.images;
  const isPartial =
    images !== null && (images.unavailableReason !== null || images.saved < images.total);
  const doneKind: MessageKind = isPartial ? "notice" : "ok";
  return (
    <Card heading={generationHeading}>
      {isRunning ? (
        <ProgressBar done={state.generation.done} total={state.generation.total} />
      ) : null}
      {label === "" ? null : (
        <Message
          kind={isFailed ? "error" : state.generation.phase === "done" ? doneKind : "info"}
          text={label}
        />
      )}
      {props.blocked !== null ? <Message kind="error" text={props.blocked} /> : null}
      {isRunning ? (
        <Actions>
          <Button variant="secondary" onClick={() => void window.keycheer.cancelGeneration()}>
            中断
          </Button>
        </Actions>
      ) : null}
    </Card>
  );
}

// 作り直しの確認(論点 0038)
function RebuildDialog(props: {
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNS.ReactElement {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-6">
      <div
        role="dialog"
        aria-modal
        className="flex w-full max-w-md flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card"
      >
        <p className="m-0 leading-relaxed">{REBUILD_CONFIRMATION_TEXT}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={props.onCancel}>
            取りやめる
          </Button>
          <Button variant="primary" onClick={props.onConfirm}>
            作り直す
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CharacterScreen(props: {
  state: MainScreenState;
  editor: CharacterEditor;
  status: string | null;
  regeneration: ImageRegeneration;
  isAnythingRunning: boolean;
}): ReactNS.ReactElement {
  const { state, editor } = props;
  const generatingItem = state.items.find((c) => c.id === state.generatingCharacterId);
  return (
    <>
      <Title text="キャラクター" />
      <TwoColumns>
        {/* 保存済みのキャラクターを一覧から選んで編集・生成する。先頭は新規作成 */}
        <CharacterList label="キャラクター">
          <button
            type="button"
            role="option"
            aria-selected={editor.editingId === null}
            onClick={() => editor.edit(null)}
            className={`flex w-full items-center gap-3 rounded-card border border-dashed p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              editor.editingId === null
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-muted hover:text-fg"
            }`}
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface text-lg">+</span>
            新しく作る
          </button>
          {state.items.map((c) => (
            <CharacterCard
              key={c.id}
              name={c.name}
              meta={c.isGenerating ? null : c.hasPool ? "生成済み" : "まだ生成していません"}
              pills={statusPills(c.isActive, c.isGenerating)}
              thumbnailUrl={thumbnailOf(c)}
              isSelected={editor.editingId === c.id}
              onClick={() => editor.edit(c.id)}
            />
          ))}
        </CharacterList>
        <div className="flex min-w-0 flex-col gap-4">
          <FormCard editor={editor} state={state} status={props.status} />
          {canShowGenerationControls(state.screen, state.generation) ? (
            <GenerationCard state={state} blocked={editor.blocked} />
          ) : null}
          {/* S0061_05 / S0050_01 完了したら、生成したキャラクターの 3 枚を出す */}
          {canShowGeneratedImages(state.generation) && generatingItem !== undefined ? (
            <ImagePanel
              item={generatingItem}
              regeneration={props.regeneration}
              isAnythingRunning={props.isAnythingRunning}
            />
          ) : null}
        </div>
      </TwoColumns>
      {editor.rebuildConfirmId === null ? null : (
        <RebuildDialog onCancel={editor.cancelRebuild} onConfirm={editor.confirmRebuild} />
      )}
    </>
  );
}
