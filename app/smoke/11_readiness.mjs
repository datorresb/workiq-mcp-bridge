import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

for (const packaged of [false, true]) {
  test(`tray icons resolve in ${packaged ? "packaged" : "development"} mode and Starting offers Stop`, () => {
    const path = require("node:path");
    const root = path.resolve("tray-test");
    const images = [];
    let menu;
    let stopped = false;
    const exports = {};
    const source = readFileSync(new URL("../src/main/tray.ts", import.meta.url), "utf8");
    const expected = path.join(root, packaged ? "resources/tray" : "build");
    class FakeTray extends EventEmitter {
      setImage(image) { assert.ok(images.includes(image)); }
      setToolTip() {}
      setContextMenu(value) { menu = value; }
      destroy() {}
    }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      exports,
      process: { resourcesPath: path.join(root, "resources") },
      require: (name) => name === "path" ? path : {
        app: { isPackaged: packaged, getAppPath: () => root },
        Tray: FakeTray,
        Menu: { buildFromTemplate: (items) => items },
        nativeImage: { createFromPath: (icon) => {
          assert.equal(path.dirname(icon), expected);
          const image = { name: path.basename(icon), isEmpty: () => false };
          images.push(image);
          return image;
        } },
      },
    });
    const tray = exports.createTray({}, { start() {}, stop() { stopped = true; }, quit() {} });
    assert.deepEqual(images.map((image) => image.name).sort(), ["tray-gray.ico", "tray-green.ico", "tray-red.ico"]);
    for (const status of ["starting", "running", "unhealthy", "restarting"]) {
      tray.update(status);
      assert.equal(menu[0].label, "Stop Bridge");
    }
    menu[0].click();
    assert.equal(stopped, true);
    tray.destroy();
  });
}

function supervisorFixture() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const exports = {};
  const source = readFileSync(new URL("../src/main/supervisor.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(compiled.outputText, {
    exports,
    require: Object.assign(function (name) {
      if (name === "child_process") return { spawn: () => child };
      if (name === "./port") return { freePort: async () => child.emit("close", 0) };
      if (name === "./watchdog") {
        return { RestartPolicy: class { reset() {} nextDelay() { return 100; } } };
      }
      return require(name);
    }, { resolve: require.resolve }),
    process: { execPath: process.execPath, env: {} },
    setTimeout: () => ({}),
    clearTimeout() {},
    Buffer,
  });
  return { child, supervisor: new exports.BridgeSupervisor({ port: 3100 }) };
}

test("spawning the shell does not mean the MCP is ready", () => {
  const { child, supervisor } = supervisorFixture();
  supervisor.start();
  child.emit("spawn");
  assert.equal(supervisor.status, "starting");
});

test("only a successful readiness check marks the MCP running", () => {
  const { child, supervisor } = supervisorFixture();
  supervisor.start();
  child.emit("spawn");
  supervisor.markUnhealthy(false);
  assert.equal(supervisor.status, "running");
  supervisor.markUnhealthy(true);
  assert.equal(supervisor.status, "unhealthy");
  supervisor.markUnhealthy(false);
  assert.equal(supervisor.status, "running");
});

test("a late readiness response cannot restart a stopped supervisor", async () => {
  const { child, supervisor } = supervisorFixture();
  supervisor.start();
  child.emit("spawn");
  await supervisor.stop();
  supervisor.markUnhealthy(false);
  assert.equal(supervisor.status, "stopped");
});

function healthFixture(probeMcp) {
  const exports = {};
  const source = readFileSync(new URL("../src/main/health.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(compiled.outputText, {
    exports,
    require: (name) => name === "./mcp" ? { probeMcp } : require(name),
    fetch: async () => ({ status: 200 }),
    AbortController,
    AbortSignal,
    setInterval: () => ({}),
    clearInterval() {},
  });
  const health = new exports.HealthPoller({ port: 3100 });
  const changes = [];
  health.on("health", (ok) => changes.push(ok));
  return { health, changes };
}

test("HTTP 200 does not mean ready when the MCP handshake fails", async () => {
  const { health, changes } = healthFixture(async () => { throw new Error("MCP initialization failed"); });
  assert.equal(await health.pollOnce(), false);
  assert.deepEqual(changes, [false]);
});

test("MCP readiness is checked once per start, not every health poll", async () => {
  let probes = 0;
  const { health, changes } = healthFixture(async () => { probes += 1; });
  assert.equal(await health.pollOnce(), true);
  assert.equal(await health.pollOnce(), true);
  assert.equal(probes, 1);
  assert.deepEqual(changes, [true]);
  health.stop();
  assert.equal(await health.pollOnce(), true);
  assert.equal(probes, 2);
});

test("Stop discards a pending MCP readiness result", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { health, changes } = healthFixture(() => pending);
  const poll = health.pollOnce();
  await Promise.resolve();
  health.stop();
  finish();
  assert.equal(await poll, false);
  assert.deepEqual(changes, []);
});

test("Doctor only returns real prerequisite checks", async () => {
  const exports = {};
  const source = readFileSync(new URL("../src/main/doctor.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require: (name) => name === "child_process"
      ? { execFile: (command, args, options, done) => done(null, "yes") }
      : { isPortInUse: async () => false },
  });
  const results = await exports.runDoctor(3100);
  assert.deepEqual(Array.from(results, (result) => result.id), ["npx", "firewall", "port"]);
});

test("controller blocks duplicate tests and ignores results after Stop", async () => {
  const exports = {};
  const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  let complete;
  let calls = 0;
  let signal;
  let update;
  const empty = (port) => ({ port, http: { status: "idle" }, mcp: { status: "idle" }, m365: { status: "idle" } });
  const dependencies = {
    electron: { app: { requestSingleInstanceLock: () => false, quit() {} } },
    "./supervisor": { BridgeSupervisor: class extends EventEmitter {
      status = "running";
      activePort = 3100;
      markUnhealthy() {}
      async stop() { this.status = "stopped"; this.emit("status", "stopped"); }
    } },
    "./health": { HealthPoller: class extends EventEmitter { stop() {} } },
    "./logs": { RollingLog: class { append() {} } },
    "./config": { loadConfig: () => ({ port: 3100 }), logFilePath: () => "unused" },
    "./mcp": {
      emptyConnectionReport: empty,
      testConnection: (port, onUpdate, abortSignal) => {
        calls += 1;
        signal = abortSignal;
        update = onUpdate;
        return new Promise((resolve) => { complete = resolve; });
      },
    },
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require: (name) => name === "path" ? require(name) : (dependencies[name] ?? {}),
    AbortController,
  });
  const controller = new exports.AppController();
  const pending = controller.testConnection();
  await assert.rejects(controller.testConnection(), /already running/);
  assert.equal(calls, 1);
  await controller.stop();
  assert.equal(signal.aborted, true);
  update({ ...empty(3100), m365: { status: "pass" } });
  complete(empty(3100));
  await pending;
  assert.equal(controller.state().connectionTest.m365.status, "idle");
  await assert.rejects(controller.testConnection(), /Start the bridge/);
  controller.supervisor.status = "running";
  const second = controller.testConnection();
  update({ ...empty(3100), m365: { status: "pass" } });
  complete(empty(3100));
  await second;
  controller.health.emit("health", false);
  assert.equal(controller.state().connectionTest.m365.status, "idle");
});