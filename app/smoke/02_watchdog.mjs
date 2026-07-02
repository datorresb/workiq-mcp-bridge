// Smoke 02 — the watchdog must restart an unexpected crash but NOT a manual
// stop. Requires a prior build (npm run build).
//   node smoke/02_watchdog.mjs [port]
import { createRequire } from "module";
import { setTimeout as delay } from "timers/promises";

const require = createRequire(import.meta.url);
const { BridgeSupervisor } = require("../dist/main/supervisor.js");
const { freePort, isPortInUse } = require("../dist/main/port.js");

const port = Number(process.argv[2] || 3100);
const sup = new BridgeSupervisor({ port });
let restarts = 0;
sup.on("status", (s) => {
  if (s === "restarting") restarts++;
  console.log("[status]", s);
});

sup.start();
await delay(9000);

const pid = sup.pid;
if (!pid) {
  console.error("FAIL: no child pid after start");
  process.exit(1);
}

// Simulate a crash by killing the tree out from under the supervisor.
await freePort(pid);
await delay(7000);
// The restart must produce a LIVE bridge again, not just a status event.
const backUp = sup.pid != null && (await isPortInUse(port));
const restartedAfterCrash = restarts >= 1 && backUp;

// A manual stop must not trigger a restart.
const before = restarts;
await sup.stop();
await delay(4000);
const restartedAfterStop = restarts > before;

const ok = restartedAfterCrash && !restartedAfterStop;
console.log(`crash -> restart: ${restartedAfterCrash}; manual stop -> no restart: ${!restartedAfterStop}`);
console.log(ok ? "PASS: watchdog" : "FAIL: watchdog");
process.exit(ok ? 0 : 1);
