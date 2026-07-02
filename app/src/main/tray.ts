import { Tray, Menu, nativeImage, NativeImage, BrowserWindow } from "electron";
import * as path from "path";
import { BridgeStatus } from "./supervisor";

type IconState = "running" | "stopped" | "error";

function iconStateFor(status: BridgeStatus): IconState {
  if (status === "running") return "running";
  if (status === "unhealthy") return "error";
  return "stopped";
}

function isActive(status: BridgeStatus): boolean {
  return status === "running" || status === "unhealthy" || status === "restarting";
}

export interface TrayController {
  update(status: BridgeStatus): void;
  destroy(): void;
}

export interface TrayHandlers {
  start: () => void;
  stop: () => void;
  quit: () => void;
}

export function createTray(win: BrowserWindow, handlers: TrayHandlers): TrayController {
  const iconPath = (name: string): string =>
    path.join(__dirname, "..", "..", "build", `${name}.ico`);

  const icons: Record<IconState, NativeImage> = {
    running: nativeImage.createFromPath(iconPath("tray-green")),
    stopped: nativeImage.createFromPath(iconPath("tray-gray")),
    error: nativeImage.createFromPath(iconPath("tray-red")),
  };

  const base = icons.stopped.isEmpty() ? nativeImage.createEmpty() : icons.stopped;
  const tray = new Tray(base);

  tray.on("click", () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  const render = (status: BridgeStatus): void => {
    const img = icons[iconStateFor(status)];
    if (!img.isEmpty()) tray.setImage(img);
    tray.setToolTip(`WorkIQ Bridge — ${status}`);
    const active = isActive(status);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: active ? "Stop Bridge" : "Start Bridge",
          click: () => (active ? handlers.stop() : handlers.start()),
        },
        {
          label: "Show Window",
          click: () => {
            win.show();
            win.focus();
          },
        },
        { type: "separator" },
        { label: "Quit", click: () => handlers.quit() },
      ])
    );
  };

  render("stopped");

  return {
    update: render,
    destroy: () => tray.destroy(),
  };
}
