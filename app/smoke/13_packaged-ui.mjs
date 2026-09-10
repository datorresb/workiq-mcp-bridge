import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";

const executable = path.resolve(process.argv[2]);
const profile = await mkdtemp(path.join(tmpdir(), "workiq-ui-test-"));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(executable, [`--user-data-dir=${profile}`, "--remote-debugging-port=0"], {
  stdio: ["ignore", "pipe", "pipe"], windowsHide: false,
});
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Packaged app did not expose its test endpoint")), 60000);
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Packaged app exited: ${code}`)); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 180000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const targets = await command("Target.getTargets");
  const target = targets.targetInfos.find((entry) => entry.type === "page");
  assert.ok(target, "Packaged window exists");
  const { sessionId } = await command("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  async function evaluate(expression) {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }
  await evaluate(`new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, {once:true});
  })`);
  const state = await evaluate("window.bridgeAPI.state()");
  assert.equal(state.metrics.status, "stopped", "Isolated test app is stopped");
  await evaluate(`window.bridgeAPI.saveSettings({port:${port},notifications:false})`);
  async function waitFor(expression) {
    return evaluate(`new Promise((resolve,reject) => {
      const check = () => { if (${expression}) { observer.disconnect(); clearTimeout(timer); resolve(true); } };
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => {observer.disconnect();reject(new Error('UI state timeout'));},150000);
      observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
      check();
    })`);
  }
  await evaluate("document.getElementById('toggle-btn').click()");
  await waitFor("document.getElementById('test-connection').disabled === false");
  assert.equal(await evaluate("document.getElementById('check-m365-status').textContent"), "Not checked");
  await evaluate("document.getElementById('test-connection').click()");
  await waitFor("document.getElementById('test-connection').disabled === false");
  const results = await evaluate("['http','mcp','m365'].map(key => ({check:key,status:document.getElementById('check-'+key+'-status').textContent,detail:document.getElementById('check-'+key+'-detail').textContent}))");
  assert.ok(results.every((entry) => entry.status === "OK"), JSON.stringify(results));
  await evaluate("document.getElementById('doctor-btn').click()");
  await waitFor("document.querySelectorAll('#doctor-list .doctor-row').length === 3");
  assert.doesNotMatch(await evaluate("document.getElementById('doctor-list').textContent"), /registered|registration/i);
  await evaluate("document.getElementById('doctor-close').click(); document.getElementById('toggle-btn').click()");
  await waitFor("document.getElementById('status-name').textContent === 'Stopped'");
  assert.equal(await evaluate("document.getElementById('check-m365-status').textContent"), "Not checked");
  console.log(JSON.stringify({ result: "PASS", executable, port, profile, results }));
  await command("Browser.close").catch(() => {});
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, "exit");
  }
}