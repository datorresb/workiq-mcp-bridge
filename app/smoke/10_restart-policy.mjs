// Smoke 10 — RestartPolicy backoff / cap / reset. Pure logic; needs a build
// (npm run build) but no bridge. Runs anywhere.
//   node smoke/10_restart-policy.mjs
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { RestartPolicy } = require("../dist/main/watchdog.js");

let ok = true;
const check = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    ok = false;
  }
};

// base 100ms, jitter is + [0,499]; delays are base * 2^(n-1) + jitter.
const p = new RestartPolicy(3, 100, 1000);
const d1 = p.nextDelay();
const d2 = p.nextDelay();
const d3 = p.nextDelay();
const d4 = p.nextDelay();

check(d1 !== null && d1 >= 100 && d1 < 600, `attempt 1 delay in [100,600): ${d1}`);
check(d2 !== null && d2 >= 200 && d2 < 700, `attempt 2 delay in [200,700): ${d2}`);
check(d3 !== null && d3 >= 400 && d3 < 900, `attempt 3 delay in [400,900): ${d3}`);
check(d4 === null, `attempt 4 exceeds cap -> null: ${d4}`);
check(p.attemptCount === 4, `attemptCount tracked: ${p.attemptCount}`);

p.reset();
check(p.attemptCount === 0, `reset zeroes attempts: ${p.attemptCount}`);
check(p.nextDelay() !== null, "after reset, nextDelay resumes");

// maxDelay cap: a huge base must still be clamped to maxDelay (+ jitter < 500).
const p2 = new RestartPolicy(10, 100000, 1000);
const capped = p2.nextDelay();
check(capped !== null && capped <= 1000 + 500, `maxDelay cap respected: ${capped}`);

console.log(ok ? "PASS: RestartPolicy" : "FAIL: RestartPolicy");
process.exit(ok ? 0 : 1);
