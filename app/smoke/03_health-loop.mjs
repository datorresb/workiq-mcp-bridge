// Smoke 03 — poll /healthz and observe healthy/unhealthy transitions. Start the
// bridge separately (or run 01 first) so there is something to probe.
// Requires a prior build (npm run build).
//   node smoke/03_health-loop.mjs [port]
import { createRequire } from "module";
import { setTimeout as delay } from "timers/promises";

const require = createRequire(import.meta.url);
const { HealthPoller } = require("../dist/main/health.js");

const port = Number(process.argv[2] || 3100);
const hp = new HealthPoller({ port, intervalMs: 2000, failureThreshold: 2 });
let events = 0;
hp.on("health", (ok) => {
  events++;
  console.log("[health]", ok ? "✓ healthy" : "✗ unhealthy");
});

hp.start();
console.log(`Polling http://localhost:${port}/healthz every 2s for 20s…`);
await delay(20000);
hp.stop();
if (events === 0) {
  console.error("FAIL: no health state was ever emitted (is a bridge running on this port?)");
  process.exit(1);
}
console.log(`done (${events} health event(s) observed)`);
process.exit(0);
