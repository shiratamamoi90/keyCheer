// localEndpoints: ローカルのランタイム(Ollama / VOICEVOX ENGINE)の接続先(論点 0034 / 0078)。
//
// 宛先は 127.0.0.1。同梱ランタイムはここだけで待ち受ける(S0034_12)。`localhost` にすると、Windows では IPv6 の ::1 を
// 先に引いて繋がらないことがある(論点 0078)。設定の既定値・同梱ランタイム・話者一覧の取得がこの値を読む。

export const LOOPBACK_HOST = "127.0.0.1";
export const OLLAMA_PORT = 11434;
export const VOICEVOX_PORT = 50021;

export const DEFAULT_OLLAMA_ENDPOINT = `http://${LOOPBACK_HOST}:${OLLAMA_PORT}`;
export const DEFAULT_VOICEVOX_ENDPOINT = `http://${LOOPBACK_HOST}:${VOICEVOX_PORT}`;

// 論点 0078 より前の既定値。保存値がこれと完全に同じときだけ、読み込みで新しい既定値に移す
export const LEGACY_DEFAULT_OLLAMA_ENDPOINT = `http://localhost:${OLLAMA_PORT}`;
export const LEGACY_DEFAULT_VOICEVOX_ENDPOINT = `http://localhost:${VOICEVOX_PORT}`;
