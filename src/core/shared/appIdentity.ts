// appIdentity: 利用者に見えるアプリの名前と、データの置き場の名前(論点 0077)。
//
// 見える名前は TypeYell。プロジェクトの名前(リポジトリ・npm の名前・IPC の名前・ログの先頭)は keyCheer のまま。
// データの置き場 {userData} は前の版から変えない(%APPDATA%\keycheer)— 変えると今のキャラクター・設定・重みを移す仕組みが要る。
// インストーラの表示名は package.json の productName(electron-builder が読む)。値を変えるときはそこも同時に直す。

export const APP_DISPLAY_NAME = "TypeYell";

// {userData} のフォルダの名前(npm の名前と同じ。アンインストールで electron-builder が消す名前でもある)
export const USER_DATA_DIR_NAME = "keycheer";
