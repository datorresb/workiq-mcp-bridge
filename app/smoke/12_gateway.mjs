import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

if (process.argv.includes("--fixture")) {
  const input = createInterface({ input: process.stdin });
  input.on("close", () => process.exit(0));
  input.on("line", (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    let result = request.method === "initialize"
      ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } }
      : { tools: process.argv.includes("--empty-tools") ? [] : [{ name: "ping", description: "Test tool", inputSchema: { type: "object" } }] };
    if (request.method === "tools/list" && !process.argv.includes("--empty-tools")) {
      result.tools.push({ name: "list_agents", inputSchema: { type: "object" } });
    }
    if (request.method === "tools/call") {
      result = process.argv.includes("--access-error")
        ? { isError: true, content: [{ type: "text", text: "Sign-in required by fixture" }] }
        : { content: [{ type: "text", text: process.argv.includes("--bad-access") ? "Not a list" : "[]" }] };
    }
    const delay = request.params?.clientInfo?.name === "cancel-probe" ? 100 : 500;
    const response = process.argv.includes("--mcp-error")
      ? { jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "fixture MCP failure" } }
      : { jsonrpc: "2.0", id: request.id, result };
    setTimeout(() => process.stdout.write(JSON.stringify(response) + "\n"), delay);
  });
} else {
  const { probeMcp, testConnection } = require("../dist/main/mcp.js");

  async function startGateway(context, mode = "") {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const fixture = `"${process.execPath}" "${fileURLToPath(import.meta.url)}" --fixture ${mode}`;
    const child = spawn(process.execPath, [
      require.resolve("supergateway/dist/index.js"), "--stdio", fixture,
      "--port", String(port), "--outputTransport", "streamableHttp",
      "--healthEndpoint", "/healthz",
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    context.after(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((resolve) => require("tree-kill")(child.pid, "SIGKILL", resolve));
    });
    let logs = "";
    child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
    child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
    function waitForLog(text) {
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout.off("data", check);
          child.stderr.off("data", check);
          child.off("exit", exited);
        };
        const check = () => {
          if (!logs.includes(text)) return;
          cleanup();
          resolve();
        };
        const exited = () => { cleanup(); reject(new Error(`Gateway exited: ${logs}`)); };
        const timer = setTimeout(() => { cleanup(); reject(new Error(`Missing gateway log: ${text}\n${logs}`)); }, 60000);
        child.stdout.on("data", check);
        child.stderr.on("data", check);
        child.once("exit", exited);
        check();
      });
    }
    await waitForLog("Listening on port");
    return { child, port, waitForLog, logs: () => logs };
  }

  function post(port, body, signal = AbortSignal.timeout(10000)) {
    return fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  }

  test("a canceled initialize does not kill the gateway or the next request", { timeout: 90000 }, async (context) => {
    const gateway = await startGateway(context);
    const abort = new AbortController();
    const canceled = post(gateway.port, {
      jsonrpc: "2.0", id: 701, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cancel-probe", version: "1.0.0" } },
    }, abort.signal).catch((error) => error);
    await gateway.waitForLog("Tracking initialize request ID: 701");
    abort.abort();
    assert.equal((await canceled).name, "AbortError");
    const response = await post(gateway.port, { jsonrpc: "2.0", id: 702, method: "tools/list", params: {} });
    assert.equal(response.status, 200, gateway.logs());
    const messages = (await response.text()).split(/\r?\n/)
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    assert.equal(messages.find((message) => message.id === 702)?.result?.tools?.[0]?.name, "ping", gateway.logs());
    assert.equal(gateway.child.exitCode, null, gateway.logs());
  });

  test("the readiness probe validates initialize and tools/list over HTTP", { timeout: 90000 }, async (context) => {
    const gateway = await startGateway(context);
    const result = await probeMcp(gateway.port);
    assert.deepEqual(result, { serverName: "fixture", toolCount: 2 });
    assert.equal(gateway.child.exitCode, null, gateway.logs());
  });

  test("the readiness probe rejects MCP errors carried by HTTP 200", { timeout: 90000 }, async (context) => {
    const gateway = await startGateway(context, "--mcp-error");
    await assert.rejects(probeMcp(gateway.port), /fixture MCP failure/);
  });

  test("the readiness probe rejects a server without tools", { timeout: 90000 }, async (context) => {
    const gateway = await startGateway(context, "--empty-tools");
    await assert.rejects(probeMcp(gateway.port), /MCP returned no tools/);
  });

  test("manual connection test reports real HTTP, MCP and M365 results", { timeout: 90000 }, async (context) => {
    const gateway = await startGateway(context);
    const updates = [];
    const report = await testConnection(gateway.port, (update) => updates.push(update));
    assert.equal(report.http.status, "pass");
    assert.equal(report.mcp.status, "pass");
    assert.equal(report.m365.status, "pass");
    assert.equal(updates[0].m365.status, "idle");
    assert.ok(updates.some((update) => update.mcp.status === "pass" && update.m365.status === "checking"));
  });

  for (const mode of ["--access-error", "--bad-access"]) {
    test(`manual test does not mark M365 ready on ${mode}`, { timeout: 90000 }, async (context) => {
      const gateway = await startGateway(context, mode);
      const report = await testConnection(gateway.port, () => {});
      assert.equal(report.http.status, "pass");
      assert.equal(report.mcp.status, "pass");
      assert.equal(report.m365.status, "fail");
    });
  }

  test("a failed MCP handshake leaves M365 untested", { timeout: 90000 }, async (context) => {
    const gateway = await startGateway(context, "--mcp-error");
    const report = await testConnection(gateway.port, () => {});
    assert.equal(report.http.status, "pass");
    assert.equal(report.mcp.status, "fail");
    assert.equal(report.m365.status, "idle");
  });

  test("canceling a manual test discards results", { timeout: 90000 }, async (context) => {
    const gateway = await startGateway(context);
    const controller = new AbortController();
    const report = await testConnection(gateway.port, (update) => {
      if (update.mcp.status === "checking") controller.abort();
    }, controller.signal);
    assert.equal(report.m365.status, "idle");
    assert.equal(report.mcp.status, "idle");
  });
}