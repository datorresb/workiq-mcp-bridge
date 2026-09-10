import { BridgeStatus } from "./supervisor";
import { AppConfig } from "./config";
import { ConnectionReport } from "./mcp";

export interface Metrics {
  status: BridgeStatus;
  healthy: boolean;
  httpReady: boolean;
  toolCount: number | null;
  uptimeMs: number;
  port: number;
  /** Best-effort — null when supergateway does not surface it. */
  clients: number | null;
  /** Best-effort — null when supergateway does not surface it. */
  requests: number | null;
}

export interface AppState {
  settings: AppConfig;
  metrics: Metrics;
  connectionTest: ConnectionReport;
}
