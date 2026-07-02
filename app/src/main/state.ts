import { BridgeStatus } from "./supervisor";
import { AppConfig } from "./config";

export interface Metrics {
  status: BridgeStatus;
  healthy: boolean;
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
}
