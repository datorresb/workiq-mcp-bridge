import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { RestartPolicy } from "./watchdog";
import { freePort } from "./port";

export type BridgeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "unhealthy"
  | "restarting";

export interface SupervisorOptions {
  port: number;
}

/**
 * Owns the `supergateway -> workiq mcp` child-process tree: spawns it, streams
 * its output as `log` events, tears the whole tree down with tree-kill, and
 * auto-restarts unexpected crashes (never an intentional stop).
 */
export class BridgeSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private intentionalStop = false;
  private readonly policy = new RestartPolicy();
  private stableTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private _status: BridgeStatus = "stopped";

  constructor(private readonly options: SupervisorOptions) {
    super();
  }

  get status(): BridgeStatus {
    return this._status;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get activePort(): number {
    return this.options.port;
  }

  start(): void {
    if (this.child) return;
    this.intentionalStop = false;
    this.clearRestartTimer();
    this.policy.reset();
    this.spawnChild();
  }

  stop(): Promise<void> {
    this.intentionalStop = true;
    this.clearStableTimer();
    this.clearRestartTimer();
    return new Promise((resolve) => {
      const pid = this.child?.pid;
      if (!pid) {
        this.child = null;
        this.setStatus("stopped");
        resolve();
        return;
      }
      // freePort -> tree-kill -> taskkill /T /F on Windows (EPERM/ESRCH tolerated).
      void freePort(pid).then(() => resolve());
    });
  }

  markUnhealthy(unhealthy: boolean): void {
    if (this._status === "running" && unhealthy) this.setStatus("unhealthy");
    else if (this._status === "unhealthy" && !unhealthy) this.setStatus("running");
  }

  private setStatus(status: BridgeStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.emit("status", status);
  }

  private buildCommand(): string {
    // shell: true is the robust way to launch npx on Windows — a bare
    // npx/npx.cmd spawn fails without a shell. tree-kill /T still reaps the tree.
    return [
      "npx",
      "-y",
      "supergateway",
      "--stdio",
      '"npx -y @microsoft/workiq mcp"',
      "--port",
      String(this.options.port),
      "--outputTransport",
      "streamableHttp",
      "--healthEndpoint",
      "/healthz",
    ].join(" ");
  }

  private spawnChild(): void {
    this.setStatus(this._status === "stopped" ? "starting" : "restarting");
    const child = spawn(this.buildCommand(), {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout?.on("data", (d: Buffer) => this.emitLog(d));
    child.stderr?.on("data", (d: Buffer) => this.emitLog(d));

    child.on("spawn", () => {
      this.setStatus("running");
      this.armStableTimer();
    });

    child.on("error", (err: Error) => {
      this.emit("log", `spawn error: ${err.message}`);
      this.emit("error", err);
    });

    child.on("close", () => {
      this.child = null;
      this.clearStableTimer();
      if (this.intentionalStop) {
        this.setStatus("stopped");
        return;
      }
      const delay = this.policy.nextDelay();
      if (delay === null) {
        this.setStatus("stopped");
        this.emit(
          "error",
          new Error("Bridge crashed repeatedly; giving up on auto-restart.")
        );
        return;
      }
      this.emit(
        "log",
        `Bridge exited unexpectedly; restarting in ${delay}ms (attempt ${this.policy.attemptCount}).`
      );
      this.setStatus("restarting");
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (!this.intentionalStop && !this.child) this.spawnChild();
      }, delay);
    });
  }

  private emitLog(chunk: Buffer): void {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim().length > 0) this.emit("log", line);
    }
  }

  private armStableTimer(): void {
    this.clearStableTimer();
    // Reset the restart counter once the bridge has survived 30s.
    this.stableTimer = setTimeout(() => this.policy.reset(), 30_000);
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}
