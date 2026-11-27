// settingsScreen: 設定画面(表示・応援・生成。論点 0033 / 0036 / 0053 / 0057 / 0070)。
// テーマの当て方は theme.ts、応援の欄の値域は triggerSettings.ts(どちらも純粋なコントローラでテスト済み)。
// ここは読み込みと保存の配線と表示だけ。

import type * as ReactNS from "react";
import {
  THEME_SETTINGS,
  type GenerationConfig,
  type PopupDisplayConfig,
  type ThemeSetting,
  type TriggerConfig,
} from "../core/shared/types.js";
import { createThemeController, type ThemeController } from "./theme.js";
import {
  createTriggerSettingsController,
  type TriggerField,
  type TriggerSettingsController,
} from "./triggerSettings.js";
import {
  Card,
  FIELD_BASE_CLASS,
  NumberField,
  SettingRow,
  SettingRows,
  Title,
  ToggleSwitch,
} from "./ui.js";

// テーマの選択肢の文言(論点 0057)
const THEME_LABELS: Record<ThemeSetting, string> = {
  system: "システムに合わせる",
  light: "ライト",
  dark: "ダーク",
};

// 設定の読み込みと保存。テーマは窓を開いた時点で当てるので、設定画面を開く前からアプリの根が持つ
export function useSettings() {
  const [generationConfig, setGenerationConfig] = React.useState<GenerationConfig | null>(null);
  // 常時表示(論点 0036)とセリフの表示(論点 0053)
  const [popupDisplay, setPopupDisplay] = React.useState<PopupDisplayConfig | null>(null);
  // テーマ(論点 0057)。見た目は <html> の dark クラスで切り替える
  const [theme, setTheme] = React.useState<ThemeSetting | null>(null);
  const themeControllerRef = React.useRef<ThemeController | null>(null);
  // 応援の回数・秒数・節目(論点 0070)
  const [triggers, setTriggers] = React.useState<TriggerConfig | null>(null);
  const triggerControllerRef = React.useRef<TriggerSettingsController | null>(null);

  React.useEffect(() => {
    let off: (() => void) | null = null;
    void window.keycheer.getTheme().then((snapshot) => {
      setTheme(snapshot.theme);
      const controller = createThemeController({
        setting: snapshot.theme,
        isOsDark: snapshot.isOsDark,
        apply: (resolved) => document.documentElement.classList.toggle("dark", resolved === "dark"),
        save: (next) => void window.keycheer.setTheme(next),
      });
      themeControllerRef.current = controller;
      // S0057_02 OS の設定が変わったらすぐ反映する
      off = window.keycheer.onOsThemeChanged((isOsDark) => controller.onOsChanged(isOsDark));
    });
    return () => off?.();
  }, []);

  React.useEffect(() => {
    void window.keycheer.getGenerationConfig().then(setGenerationConfig);
    void window.keycheer.getPopupDisplay().then(setPopupDisplay);
    void window.keycheer.getTriggerConfig().then((config) => {
      triggerControllerRef.current = createTriggerSettingsController({
        config,
        // main が同じ値域で検証し、保存して次の打鍵から効かせる(S0070_02)
        save: (next) => void window.keycheer.updateTriggerConfig(next),
      });
      setTriggers(config);
    });
  }, []);

  // S0057_03 設定画面でテーマを選ぶとすぐ反映する
  const changeTheme = (next: ThemeSetting): void => {
    setTheme(next);
    themeControllerRef.current?.onSettingChanged(next);
  };

  const changeActivateOnComplete = (checked: boolean): void => {
    const next = { shouldActivateOnComplete: checked };
    void window.keycheer.setGenerationConfig(next).then((result) => {
      if (result.ok) setGenerationConfig(next);
    });
  };

  // S0036_29 設定画面で常時表示を切り替える(保存すると main が再起動なしで窓を出す・隠す)
  // S0053_08 設定画面でセリフを出すかを切り替える(次の応援から効く)
  // 2 つは同じ設定(popup の表示)として保存する。変えていない方は読み込んだ値のまま送る
  const changePopupDisplay = (change: Partial<PopupDisplayConfig>): void => {
    if (popupDisplay === null) return;
    const next = { ...popupDisplay, ...change };
    void window.keycheer.setPopupDisplay(next).then((result) => {
      if (result.ok) setPopupDisplay(next);
    });
  };

  const commitTrigger = (field: TriggerField, input: string): number => {
    const controller = triggerControllerRef.current;
    if (controller === null) return 0;
    const value = controller.commitField(field, input);
    setTriggers(controller.getConfig());
    return value;
  };

  const setMilestoneEnabled = (checked: boolean): void => {
    const controller = triggerControllerRef.current;
    if (controller === null) return;
    controller.setMilestoneEnabled(checked);
    setTriggers(controller.getConfig());
  };

  return {
    generationConfig,
    popupDisplay,
    theme,
    triggers,
    triggerController: triggerControllerRef.current,
    changeTheme,
    changeActivateOnComplete,
    changePopupDisplay,
    commitTrigger,
    setMilestoneEnabled,
  };
}

export type Settings = ReturnType<typeof useSettings>;

function TriggerRow(props: {
  settings: Settings;
  field: TriggerField;
  label: string;
}): ReactNS.ReactElement {
  const { settings, field, label } = props;
  const controller = settings.triggerController;
  const range = controller?.getFieldRange(field) ?? { min: 0, max: 0 };
  return (
    <SettingRow label={label}>
      <NumberField
        label={label}
        value={settings.triggers?.[field] ?? 0}
        min={range.min}
        max={range.max}
        disabled={
          controller === null ||
          (field === "milestoneInterval" && !controller.isMilestoneIntervalEditable())
        }
        onCommit={(input) => settings.commitTrigger(field, input)}
      />
    </SettingRow>
  );
}

export function SettingsScreen(props: { settings: Settings }): ReactNS.ReactElement {
  const { settings } = props;
  return (
    <>
      <Title text="設定" />
      <Card heading="表示">
        <SettingRows>
          <SettingRow label="キャラを常に表示する">
            <ToggleSwitch
              label="キャラを常に表示する"
              checked={settings.popupDisplay?.shouldAlwaysShow ?? true}
              disabled={settings.popupDisplay === null}
              onChange={(checked) => settings.changePopupDisplay({ shouldAlwaysShow: checked })}
            />
          </SettingRow>
          <SettingRow label="セリフを表示する(外しても音声は鳴ります)">
            <ToggleSwitch
              label="セリフを表示する"
              checked={settings.popupDisplay?.shouldShowMessage ?? true}
              disabled={settings.popupDisplay === null}
              onChange={(checked) => settings.changePopupDisplay({ shouldShowMessage: checked })}
            />
          </SettingRow>
          <SettingRow label="テーマ">
            <select
              aria-label="テーマ"
              className={`${FIELD_BASE_CLASS} shrink-0`}
              value={settings.theme ?? "system"}
              disabled={settings.theme === null}
              onChange={(e) => settings.changeTheme(e.target.value as ThemeSetting)}
            >
              {THEME_SETTINGS.map((value) => (
                <option key={value} value={value}>
                  {THEME_LABELS[value]}
                </option>
              ))}
            </select>
          </SettingRow>
        </SettingRows>
      </Card>
      {/* S0070_01 応援の回数・節目(止まったとみなす秒数の欄は論点 0081 で外した) */}
      <Card heading="応援">
        <SettingRows>
          <TriggerRow
            settings={settings}
            field="regular"
            label="通常の応援を出す回数(キーを押した回数ごと)"
          />
          <SettingRow label="節目の応援を出す">
            <ToggleSwitch
              label="節目の応援を出す"
              checked={settings.triggers?.isMilestoneEnabled ?? true}
              disabled={settings.triggers === null}
              onChange={settings.setMilestoneEnabled}
            />
          </SettingRow>
          <TriggerRow
            settings={settings}
            field="milestoneInterval"
            label="節目の応援を出す回数(通常の回数より大きい)"
          />
        </SettingRows>
      </Card>
      <Card heading="生成">
        <SettingRows>
          <SettingRow label="生成が完了したら、そのキャラクターを使用中にする">
            <ToggleSwitch
              label="生成が完了したら、そのキャラクターを使用中にする"
              checked={settings.generationConfig?.shouldActivateOnComplete ?? true}
              disabled={settings.generationConfig === null}
              onChange={settings.changeActivateOnComplete}
            />
          </SettingRow>
        </SettingRows>
      </Card>
    </>
  );
}
