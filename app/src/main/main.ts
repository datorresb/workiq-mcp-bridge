import { app, BrowserWindow } from "electron";
import * as path from "path";
import { BridgeSupervisor, BridgeStatus } from "./supervisor";
import { HealthPoller } from "./health";
import { RollingLog } from "./logs";
import { AppConfig, loadConfig, saveConfig, logFilePath, sanitizePort } from "./config";
import { createTray, TrayController } from "./tray";
import { notify } from "./notifications";import { isPortInUse, findPortHolder, freePort } from "./port";
import { runDoctor, fixFirewall, CheckResult } from "./doctor";
import { registerIpc } from "./ipc";
import { AppState, Metrics } from "./state";

const APP_ID = "com.datorresb.workiq-bridge";

let isQuitting = false;
let stopping = false;

export class AppController {
  config: AppConfig;
  supervisor!: BridgeSupervisor;
  health!: HealthPoller;
  window: BrowserWindow | null = null;

  private readonly log: RollingLog;
  private tray: TrayController | null = null;
  private runningSince: number | null = null;
  private healthy = false;
  private clients: number | null = null;
  private requests: number | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private conflictPid: number | null = null;
  private conflictHolderName: string | null = null;
  private lastMetrics: string | null = null;

  constructor() {
    this.config = loadConfig();
    this.log = new RollingLog(logFilePath());
    this.buildBridge();
  }

  private buildBridge(): void {
    this.supervisor = new BridgeSupervisor({ port: this.config.port });
    this.health = new HealthPoller({ port: this.config.port });

    this.supervisor.on("log", (line: string) => {
      this.log.append(line);
      this.parseMetrics(line);
      this.window?.webContents.send("bridge:log", line);
    });

    this.supervisor.on("status", (status: BridgeStatus) => {
      if (status === "running" && this.runningSince === null) {
        this.runningSince = Date.now();
      }
      if (status === "stopped") {
        this.runningSince = null;
        this.clients = null;
        this.requests = null;
        this.healthy = false;
      }
      if (status === "running") this.health.start();
      else if (status === "stopped") this.health.stop();

      this.tray?.update(status);
      this.window?.webContents.send("bridge:status", status);

      if ((status === "stopped" || status === "unhealthy") && this.config.notifications) {
        notify(
          "WorkIQ Bridge",
          status === "stopped" ? "The bridge stopped." : "The bridge is unhealthy."
        );
      }
    });

    this.supervisor.on("error", (err: Error) => {
      const line = `ERROR: ${err.message}`;
      this.log.append(line);
      this.window?.webContents.send("bridge:log", line);
    });

    this.health.on("health", (ok: boolean) => {
      this.healthy = ok;
      this.supervisor.markUnhealthy(!ok);
    });
  }

  private parseMetrics(line: string): void {
    if (/\b(new client|client connected|sse connection)\b/i.test(line)) {
      this.clients = (this.clients ?? 0) + 1;
    }
    if (/\b(request received|message received|jsonrpc)\b/i.test(line)) {
      this.requests = (this.requests ?? 0) + 1;
    }
  }

  async start(): Promise<void> {
    if (await isPortInUse(this.config.port)) {
      const holder = await findPortHolder(this.config.port);
      this.conflictPid = holder?.pid ?? null;
      this.conflictHolderName = holder?.name ?? null;
      this.log.append(
        `Port ${this.config.port} is in use by ${holder?.name ?? "another process"} (pid ${holder?.pid ?? "?"}).`
      );
      this.window?.webContents.send("bridge:portConflict", holder);
      return;
    }
    this.supervisor.start();
  }

  stop(): Promise<void> {
    return this.supervisor.stop();
  }

  async freeConflict(): Promise<void> {
    const pid = this.conflictPid;
    if (pid == null) return;
    const name = (this.conflictHolderName ?? "").toLowerCase();
    if (!/node|npx|electron|supergateway/.test(name)) {
      this.log.append(
        `Refusing to free port ${this.config.port}: holder "${this.conflictHolderName ?? "unknown"}" is not a bridge process.`
      );
      return;
    }
    await freePort(pid);
    this.conflictPid = null;
    this.conflictHolderName = null;
    this.supervisor.start();
  }

  applySettings(patch: Partial<AppConfig>): AppConfig {
    const prevPort = this.config.port;
    const clean: Partial<AppConfig> = { ...patch };
    if (clean.port !== undefined) clean.port = sanitizePort(clean.port, prevPort);
    this.config = { ...this.config, ...clean };
    saveConfig(this.config);

    if (clean.port !== undefined && clean.port !== prevPort) {
      // Rebuild against the new port; takes effect on the next Start.
      if (this.supervisor.status === "stopped") this.buildBridge();
    }
    return this.config;
  }

  metrics(): Metrics {
    return {
      status: this.supervisor.status,
      healthy: this.healthy,
      uptimeMs: this.runningSince ? Date.now() - this.runningSince : 0,
      port:
        this.supervisor.status === "stopped"
          ? this.config.port
          : this.supervisor.activePort,
      clients: this.clients,
      requests: this.requests,
    };
  }

  state(): AppState {
    return { settings: this.config, metrics: this.metrics() };
  }

  runDoctor(): Promise<CheckResult[]> {
    return runDoctor(this.config.port);
  }

  fixFirewall(): void {
    fixFirewall(this.config.port);
  }

  createWindow(): void {
    const win = new BrowserWindow({
      width: 800,
      height: 640,
      show: true,
      autoHideMenuBar: true,
      backgroundColor: "#0f1115",
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    void win.loadFile(path.join(app.getAppPath(), "src", "renderer", "index.html"));

    win.on("close", (e) => {
      if (!isQuitting) {
        e.preventDefault();
        win.hide();
      }
    });

    this.window = win;
    this.tray = createTray(win, {
      start: () => void this.start(),
      stop: () => void this.stop(),
      quit: () => {
        isQuitting = true;
        app.quit();
      },
    });
    this.tray.update(this.supervisor.status);

    this.metricsTimer = setInterval(() => {
      const m = this.metrics();
      const serialized = JSON.stringify(m);
      if (serialized === this.lastMetrics) return;
      this.lastMetrics = serialized;
      this.window?.webContents.send("bridge:metrics", m);
    }, 2000);
    this.metricsTimer.unref();
  }
}

let controller: AppController | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = controller?.window;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Windows toasts require the AppUserModelID set before any window.
    app.setAppUserModelId(APP_ID);
    controller = new AppController();
    registerIpc(controller);
    controller.createWindow();
    if (process.argv.includes("--start-bridge")) void controller.start();
  });

  app.on("before-quit", (e) => {
    isQuitting = true;
    // Tear the bridge tree down before exit so we don't orphan npx/supergateway.
    if (controller && !stopping) {
      stopping = true;
      e.preventDefault();
      void controller.stop().finally(() => app.quit());
    }
  });

  // Keep running in the tray when the window is closed.
  app.on("window-all-closed", () => {
    /* intentionally no quit — the app lives in the tray */
  });
}
