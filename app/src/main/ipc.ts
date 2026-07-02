import { ipcMain } from "electron";
import type { AppController } from "./main";
import type { AppConfig } from "./config";

/** Wire renderer requests to the controller. Push events are sent by the controller. */
export function registerIpc(controller: AppController): void {
  ipcMain.handle("bridge:start", () => controller.start());
  ipcMain.handle("bridge:stop", () => controller.stop());
  ipcMain.handle("bridge:state", () => controller.state());
  ipcMain.handle("bridge:metrics", () => controller.metrics());
  ipcMain.handle("bridge:freePort", () => controller.freeConflict());

  ipcMain.handle("settings:get", () => controller.config);
  ipcMain.handle("settings:save", (_e, patch: Partial<AppConfig>) =>
    controller.applySettings(patch)
  );

  ipcMain.handle("doctor:run", () => controller.runDoctor());
  ipcMain.handle("doctor:fixFirewall", () => {
    controller.fixFirewall();
  });
}
