import { EventEmitter } from "events";

export interface HealthPollerOptions {
  port: number;
  intervalMs?: number;
  failureThreshold?: number;
}

/**
 * Polls supergateway's `--healthEndpoint` (GET /healthz) on an interval and
 * emits `health` (boolean) when the healthy/unhealthy state changes.
 */
export class HealthPoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  private healthy = false;
  private polling = false;
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
    this.failures = 0;
    this.healthy = false;
    this.lastEmitted = null;
  }

  private healthzUrl(): string {
    return `http://localhost:${this.options.port}/healthz`;
  }

  async pollOnce(): Promise<boolean> {
    if (this.polling) return this.healthy;
    this.polling = true;
    try {
      const ok = await this.probe();
      if (ok) {
        this.failures = 0;
        if (this.lastEmitted !== true) {
          this.lastEmitted = true;
          this.healthy = true;
          this.emit("health", true);
        }
      } else {
        this.failures += 1;
        const threshold = this.options.failureThreshold ?? 3;
        if (this.failures >= threshold && this.lastEmitted !== false) {
          this.lastEmitted = false;
          this.healthy = false;
          this.emit("health", false);
        }
      }
      return ok;
    } finally {
      this.polling = false;
    }
  }

  private async probe(): Promise<boolean> {
    try {
      const res = await fetch(this.healthzUrl(), {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
