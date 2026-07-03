// Build-time mock of the preload bridgeAPI so the real renderer runs with
// scripted data for the demo GIF. Not shipped.
const { contextBridge } = require("electron");

const L = { log: [], status: [], metrics: [], conflict: [] };
const settings = { port: 3100, notifications: true };
let running = false;
let healthy = false;
let uptime = 0;
let clients = 0;
let requests = 0;
let tick = null;
let logT = null;

function snap() {
  return {
    status: running ? "running" : "stopped",
    healthy,
    uptimeMs: uptime,
    port: settings.port,
    clients: running ? clients : null,
    requests: running ? requests : null,
  };
}

function emit(k, v) {
  L[k].forEach((f) => {
    try {
      f(v);
    } catch {
      /* ignore */
    }
  });
}

const LINES = [
  "[supergateway] Listening on port 3100",
  "[supergateway] StreamableHttp endpoint: http://localhost:3100/mcp",
  "-> client connected - host.docker.internal",
  "tools/list - 14 tools",
  "handshake ok",
  "request received - ask",
  "request received - fetch",
  "-> client connected - localhost",
];

function startStreams() {
  let i = 0;
  logT = setInterval(() => {
    if (i < LINES.length) {
      emit("log", LINES[i++]);
      requests += 1;
    }
  }, 320);
  tick = setInterval(() => {
    uptime += 1000;
    if (running) clients = 1;
    emit("metrics", snap());
  }, 500);
  emit("metrics", snap());
}

contextBridge.exposeInMainWorld("bridgeAPI", {
  state: async () => ({ settings, metrics: snap() }),
  getSettings: async () => settings,
  metrics: async () => snap(),
  start: async () => {
    emit("status", "starting");
    setTimeout(() => {
      running = true;
      healthy = true;
      emit("status", "running");
      startStreams();
    }, 450);
  },
  stop: async () => {
    running = false;
    healthy = false;
    clearInterval(tick);
    clearInterval(logT);
    uptime = 0;
    emit("status", "stopped");
  },
  saveSettings: async (p) => Object.assign(settings, p),
  runDoctor: async () => [
    { id: "npx", label: "Node / npx available", status: "pass", detail: "npx 11.8.0" },
    { id: "workiq", label: "WorkIQ host registration", status: "warn", detail: "Ensure WorkIQ is registered" },
    { id: "firewall", label: "Firewall rule for Docker", status: "pass", detail: "Inbound rule present" },
    { id: "port", label: "Port 3100 availability", status: "pass", detail: "Port 3100 is free" },
  ],
  fixFirewall: async () => {},
  freePort: async () => {},
  onLog: (f) => L.log.push(f),
  onStatus: (f) => L.status.push(f),
  onMetrics: (f) => L.metrics.push(f),
  onPortConflict: (f) => L.conflict.push(f),
});
