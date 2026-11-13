// selectableSpeaker: 選べる話者(論点 0044)。
// 要件: docs/character-creation.md「選べる話者」
//
// local-voicevox で選べる声を、決まった 4 つ(話者とスタイルの組)に絞る。同梱する音声モデルを減らすためで、
// 繋いだ VOICEVOX がほかの声を返しても選択肢には出さない。
// main(一覧の絞り込み・保存の検証)と renderer(編集フォーム)の両方が使うので shared に置く。

// VOICEVOX のスタイルの ID。出典は docs/character-creation.md の表(四国めたん・春日部つむぎ・雨晴はう・玄野武宏の ノーマル)。
// 変えるときは、同梱する音声モデルとクレジット表記(docs/licenses.md)も同時に変える
export const SELECTABLE_SPEAKER_IDS: readonly number[] = [2, 8, 10, 11];

export function isSelectableSpeaker(speakerId: number): boolean {
  return SELECTABLE_SPEAKER_IDS.includes(speakerId);
}

// S0044_06 編集で、今の話者が選べる話者に無ければ未選択として出す
// 保存済みの値そのものは書き換えない(S0044_05)。フォームに出すときだけ未選択にして、選び直しを促す。
export function resolveEditableSpeakerId(speakerId: number | null): number | null {
  return speakerId !== null && isSelectableSpeaker(speakerId) ? speakerId : null;
}
