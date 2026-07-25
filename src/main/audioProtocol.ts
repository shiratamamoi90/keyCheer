// audioProtocol: renderer が wav を再生するための専用スキームを main に登録する。
// spec: changes/0007-runnable-popup-slice/spec.md「wav がある発動で音声も再生する」(確定事項 #4)
// renderer に file:// を開かせない。許可判定は audioPath.resolveAudioRequest(純粋関数・テスト済み)。
// ここは electron を触るだけの I/O グルー — 検証は typecheck / lint / 実機確認。
//
// 注: プール/wav の永続化は別 change のため、現状 `wavPath` は常に null で本経路は通らない。

import { protocol, net } from "electron";
import { pathToFileURL } from "node:url";
import { AUDIO_SCHEME, resolveAudioRequest } from "./audioPath.js";

export { AUDIO_SCHEME };

export function registerAudioProtocol(userDataDir: string): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    const filePath = resolveAudioRequest(request.url, userDataDir);
    if (filePath === null) return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
