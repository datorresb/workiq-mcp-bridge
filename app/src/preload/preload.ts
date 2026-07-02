import { contextBridge, ipcRenderer } from "electron";

type Cb<T> = (value: T) => void;

contextBridge.exposeInMainWorld("bridgeAPI", {
  // Commands (renderer -> main)
  start: () => ipcRenderer.invoke("bridge:start"),
  stop: () => ipcRenderer.invoke("bridge:stop"),
  state: () => ipcRenderer.invoke("bridge:state"),
  metrics: () => ipcRenderer.invoke("bridge:metrics"),
  freePort: () => ipcRenderer.invoke("bridge:freePort"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch: unknown) => ipcRenderer.invoke("settings:save", patch),
  runDoctor: () => ipcRenderer.invoke("doctor:run"),
  fixFirewall: () => ipcRenderer.invoke("doctor:fixFirewall"),

  // Push events (main -> renderer)
  onLog: (cb: Cb<string>) => ipcRenderer.on("bridge:log", (_e, line: string) => cb(line)),
  onStatus: (cb: Cb<string>) => ipcRenderer.on("bridge:status", (_e, s: string) => cb(s)),
  onMetrics: (cb: Cb<unknown>) => ipcRenderer.on("bridge:metrics", (_e, m: unknown) => cb(m)),
  onPortConflict: (cb: Cb<unknown>) =>
    ipcRenderer.on("bridge:portConflict", (_e, info: unknown) => cb(info)),
});
