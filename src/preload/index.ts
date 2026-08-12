// preload: contextBridge で最小 API だけを renderer に公開する。
// spec: 論点 0017「preload が公開する API は最小 [不変条件]」
// API の中身は ./api.ts(ipc 注入の純粋なファクトリ。テストはそちらで縛る)。
// ここは electron を触るだけの I/O グルー — テスト対象外、検証は typecheck / lint / 実機確認。

import { contextBridge, ipcRenderer } from "electron";
import { createKeyCheerApi, type IpcLike } from "./api.js";

// ipcRenderer をそのまま渡さず、使う 3 メソッドだけに絞ってから注入する。
const ipc: IpcLike = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    ipcRenderer.on(channel, listener);
  },
  removeListener: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  },
};

// renderer からは `window.keycheer` としてのみ見える(Node / Electron は露出しない)。
contextBridge.exposeInMainWorld("keycheer", createKeyCheerApi(ipc));
