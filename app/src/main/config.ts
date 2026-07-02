import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export interface AppConfig {
  /** Port supergateway listens on. */
  port: number;
  /** Fire a toast when the bridge goes down / unhealthy. */
  notifications: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  port: 3100,
  notifications: true,
};

function configPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    merged.port = sanitizePort(merged.port);
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Coerce an untrusted value to a valid TCP port, or fall back to a safe default. */
export function sanitizePort(value: unknown, fallback = DEFAULT_CONFIG.port): number {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

export function saveConfig(config: AppConfig): void {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
  } catch {
    // best-effort persistence
  }
}

export function logFilePath(): string {
  return path.join(app.getPath("userData"), "logs", "bridge.log");
}
