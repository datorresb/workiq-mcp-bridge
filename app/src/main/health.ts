import { EventEmitter } from "events";
import { probeMcp } from "./mcp";

export interface HealthPollerOptions {
  port: number;
  intervalMs?: number;
  failureThreshold?: number;
}

export class HealthPoller extends EventEmitter {
  httpReady = false;
  toolCount: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  private healthy = false;
  private pending: AbortController | null = null;
  private ready = false;
  private lastError: string | null = null;
  private lastEmitted: boolean | null = null;

  constructor(private readonly options: HealthPollerOptions) {
    super();
  }

  start(): void {
    this.stop();
    const interval = this.options.intervalMs ?? 10_000;
    this.timer = setInterval(() => void this.pollOnce(), interval);
    void this.pollOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pending?.abort();
    this.pending = null;
    this.httpReady = false;
    this.toolCount = null;
    this.ready = false;
    this.lastError = null;
    this.failures = 0;
    this.healthy = false;
    this.lastEmitted = null;
  }

  private healthzUrl(): string {
    return `http://localhost:${this.options.port}/healthz`;
  }

  async pollOnce(): Promise<boolean> {
    if (this.pending) return this.healthy;
    const controller = new AbortController();
    this.pending = controller;
    let httpReady = false;
    try {
      const response = await fetch(this.healthzUrl(), {
        method: "GET",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (controller.signal.aborted) return false;
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      httpReady = true;
      this.httpReady = true;
      if (!this.ready) {
        const result = await probeMcp(this.options.port, controller.signal);
        if (controller.signal.aborted) return false;
        this.toolCount = result?.toolCount ?? null;
        this.ready = true;
        this.emit("diagnostic", "MCP ready: initialize and tools/list succeeded.");
      }
      this.failures = 0;
      this.lastError = null;
      if (this.lastEmitted !== true) {
        this.lastEmitted = true;
        this.healthy = true;
        this.emit("health", true);
      }
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      this.httpReady = httpReady;
      this.toolCount = null;
      this.ready = false;
      const threshold = this.options.failureThreshold ?? 3;
      this.failures = httpReady ? threshold : this.failures + 1;
      const detail = error instanceof Error ? error.message : String(error);
      const message = `${httpReady ? "MCP not ready" : "Bridge HTTP not ready"}: ${detail}`;
      if (message !== this.lastError) {
        this.lastError = message;
        this.emit("diagnostic", message);
      }
      if (this.failures >= threshold && this.lastEmitted !== false) {
        this.lastEmitted = false;
        this.healthy = false;
        this.emit("health", false);
      }
      return false;
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
