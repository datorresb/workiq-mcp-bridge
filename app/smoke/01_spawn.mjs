// Smoke 01 — start the supergateway->workiq tree, confirm the port is
// listening, stop it, and confirm the port is released (no orphans).
// Requires a prior build (npm run build).
//   node smoke/01_spawn.mjs [port]
import { createRequire } from "module";
import { setTimeout as delay } from "timers/promises";

const require = createRequire(import.meta.url);
const { BridgeSupervisor } = require("../dist/main/supervisor.js");
const { isPortInUse } = require("../dist/main/port.js");

const port = Number(process.argv[2] || 3100);
const sup = new BridgeSupervisor({ port });
sup.on("log", (l) => console.log("[bridge]", l));
sup.on("status", (s) => console.log("[status]", s));

let ok = true;
sup.start();

// Wait (up to 30s) for the bridge to come up rather than a fixed sleep.
let up = false;
for (let i = 0; i < 30; i++) {
  if (await isPortInUse(port)) { up = true; break; }
  await delay(1000);
}
if (!up) {
  console.error("FAIL: port not listening after start");
  ok = false;
}

await sup.stop();

// Wait (up to 10s) for the port to be released.
let freed = false;
for (let i = 0; i < 10; i++) {
  if (!(await isPortInUse(port))) { freed = true; break; }
  await delay(1000);
}
if (!freed) {
  console.error("FAIL: port still in use after stop (orphaned process)");
  ok = false;
}

console.log(ok ? "PASS: spawn/stop is clean" : "FAIL: spawn/stop");
process.exit(ok ? 0 : 1);
