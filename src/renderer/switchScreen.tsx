// switchScreen: 切り替え画面(応援に使うキャラクターを選ぶ。論点 0033 / 0050)。
// 並べる中身は mainScreen.ts の buildSwitchList / switchEmptyNotice(純粋関数でテスト済み)。

import type * as ReactNS from "react";
import {
  buildSwitchList,
  switchEmptyNotice,
  type MainScreenEvent,
  type MainScreenState,
} from "./mainScreen.js";
import { ImagePanel, type ImageRegeneration } from "./imagePanel.js";
import {
  Button,
  CharacterCard,
  CharacterList,
  Message,
  statusPills,
  thumbnailOf,
  Title,
  TwoColumns,
} from "./ui.js";

const ACTIVATE_FAILURE_TEXT: Record<string, string> = {
  generating: "生成中のキャラクターは使用中にできません",
  "no-pool": "生成が済んでいません",
  "not-found": "キャラクターが見つかりません",
  "invalid-request": "切り替えられませんでした",
};

export function SwitchScreen(props: {
  state: MainScreenState;
  dispatch: (event: MainScreenEvent) => void;
  refreshCharacters: () => void;
  setStatus: (status: string | null) => void;
  regeneration: ImageRegeneration;
  isAnythingRunning: boolean;
}): ReactNS.ReactElement {
  const { state } = props;
  const notice = switchEmptyNotice(state.items);
  const entries = buildSwitchList(state.items);
  // 選んでいなければ使用中、それも無ければ先頭の 3 枚を出す
  const selectedId =
    state.selectedSwitchId ?? entries.find((e) => e.isActive)?.id ?? entries[0]?.id ?? null;
  const selected = state.items.find((item) => item.id === selectedId);
  const selectedEntry = entries.find((e) => e.id === selectedId);

  const activate = (characterId: string): void => {
    void window.keycheer.activateCharacter(characterId).then((result) => {
      props.setStatus(
        result.ok ? null : (ACTIVATE_FAILURE_TEXT[result.reason] ?? "切り替えられませんでした"),
      );
      props.refreshCharacters();
    });
  };

  return (
    <>
      <Title text="応援に使うキャラクター" />
      {/* S0033_12 プールのあるキャラクターが無ければそう示す */}
      {notice !== null ? <Message kind="notice" text={notice} /> : null}
      {entries.length === 0 ? null : (
        <TwoColumns>
          {/* S0033_10 プールの無いものは出さない / S0033_11 生成中のものは選べない形で出す */}
          <CharacterList label="応援に使うキャラクター">
            {entries.map((entry) => (
              <CharacterCard
                key={entry.id}
                name={entry.name}
                meta={null}
                pills={statusPills(entry.isActive, entry.isGenerating)}
                thumbnailUrl={thumbnailOf(state.items.find((item) => item.id === entry.id))}
                isSelected={entry.id === selectedId}
                isDimmed={!entry.isSelectable}
                // S0050_04 選ぶだけでは使用中を変えない(3 枚を見るだけ)
                onClick={() => props.dispatch({ type: "switch-selected", characterId: entry.id })}
              />
            ))}
          </CharacterList>
          {/* S0050_01 選んだキャラクターの 3 枚を一覧の横に大きく出す */}
          {selected !== undefined && selectedEntry !== undefined ? (
            <ImagePanel
              item={selected}
              regeneration={props.regeneration}
              isAnythingRunning={props.isAnythingRunning}
              leadingAction={
                <Button
                  variant="primary"
                  disabled={!selectedEntry.isSelectable || selectedEntry.isActive}
                  onClick={() => activate(selectedEntry.id)}
                >
                  {selectedEntry.isActive ? "使用中" : "これにする"}
                </Button>
              }
            />
          ) : null}
        </TwoColumns>
      )}
    </>
  );
}
