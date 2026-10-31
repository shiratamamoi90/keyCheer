// audioProtocol: renderer が wav を再生するための専用スキームを main に登録する。
// spec: 論点 0017「wav がある発動で音声も再生する」(確定事項 #4)
// renderer に file:// を開かせない。許可判定は audioPath.resolveAudioRequest(純粋関数・テスト済み)。
// ここは electron を触るだけの I/O グルー — 経路は tests/integration/audioPlayback.test.ts。

import { protocol, net } from "electron";
import { pathToFileURL } from "node:url";
import { AUDIO_SCHEME, resolveAudioRequest } from "./audioPath.js";

export { AUDIO_SCHEME };

// app の ready より前に呼ぶ(Electron の制約。ready 後の登録は効かない)。
//
// なぜ要るか:handle だけでは <audio> がこのスキームから読めず、wav が揃っていても声が出なかった
// (Windows 実機 2026-10-31)。stream は <audio> が応答を逐次読むためのもの。
// standard にしないのは、URL の正規化でパスに埋めた Windows のパス(エンコード済みの `\` や `:`)が
// 書き換わるのを避けるため。bypassCSP も付けない(popup.html の media-src で許可している)。
export function registerAudioSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: AUDIO_SCHEME, privileges: { secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

export function registerAudioProtocol(userDataDir: string): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    const filePath = resolveAudioRequest(request.url, userDataDir);
    if (filePath === null) return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
