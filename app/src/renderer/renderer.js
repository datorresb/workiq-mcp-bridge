// Renderer for the single-view WorkIQ Bridge Manager window. Plain browser
// script (no bundler). Talks to the main process only through window.bridgeAPI
// exposed by the preload script.
(function () {
  "use strict";

  const api = window.bridgeAPI;
  const MAX_LOG_LINES = 500;
  const logLines = [];
  let conflictPid = null;
  let currentStatus = "stopped";
  let currentMetrics = null;
  let connectionReport = null;
  let testing = false;
  let testSequence = 0;

  const $ = (id) => document.getElementById(id);

  function fmtUptime(ms) {
    if (!ms || ms < 1000) return "0s";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + sec + "s";
    return sec + "s";
  }

  function classifyLine(line) {
    if (/error|fail|✗/i.test(line)) return "err";
    if (/warn|retry|reconnect/i.test(line)) return "warn";
    if (/ready|listening|ok|✓|connected/i.test(line)) return "ok";
    return "";
  }

  function appendLog(line) {
    logLines.push(line);
    if (logLines.length > MAX_LOG_LINES) logLines.shift();
    const box = $("logs");
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const div = document.createElement("div");
    const cls = classifyLine(line);
    if (cls) div.className = cls;
    div.textContent = line;
    box.appendChild(div);
    while (box.childElementCount > MAX_LOG_LINES) box.removeChild(box.firstChild);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function isActive(status) {
    return status === "starting" || status === "running" || status === "unhealthy" || status === "restarting";
  }

  function renderStatus(status) {
    if (status !== currentStatus && (status === "stopped" || status === "starting" || status === "restarting")) {
      connectionReport = null;
      currentMetrics = null;
      testing = false;
      testSequence += 1;
      $("connection-error").classList.add("hidden");
    }
    currentStatus = status;
    const dot = $("dot");
    if (dot) dot.className = "dot " + status;
    const name = $("status-name");
    if (name) name.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    const toggle = $("toggle-btn");
    if (toggle) {
      if (isActive(status)) {
        toggle.textContent = "■ Stop";
        toggle.className = "btn stop";
      } else {
        toggle.textContent = "▶ Start";
        toggle.className = "btn start";
      }
    }
    renderConnection();
  }

  function renderConnection() {
    const metrics = currentMetrics;
    const active = isActive(currentStatus);
    const http = metrics && metrics.httpReady
      ? { status: "pass", detail: "Port " + metrics.port }
      : { status: active ? (currentStatus === "unhealthy" ? "fail" : "checking") : "idle", detail: "" };
    const mcp = metrics && metrics.healthy && metrics.toolCount != null
      ? { status: "pass", detail: metrics.toolCount + " tools" }
      : { status: currentStatus === "unhealthy" ? "fail" : (active && http.status === "pass" ? "checking" : "idle"), detail: "" };
    const checks = { http, mcp, m365: { status: "idle", detail: "" } };
    if (active && connectionReport && connectionReport.http.status !== "idle" && (!metrics || connectionReport.port === metrics.port)) {
      for (const key of ["http", "mcp", "m365"]) {
        checks[key] = connectionReport[key];
      }
    }
    for (const key of ["http", "mcp", "m365"]) {
      const check = checks[key];
      const status = $("check-" + key + "-status");
      status.className = "check-status " + check.status;
      status.textContent = ({ idle: "Not checked", checking: "Checking...", pass: "OK", fail: "Failed" })[check.status];
      $("check-" + key + "-detail").textContent = check.detail === "Not checked" ? "" : check.detail;
    }
    const button = $("test-connection");
    button.disabled = testing || (currentStatus !== "running" && currentStatus !== "unhealthy");
    button.textContent = testing ? "Testing..." : "Test connection";
    $("connection-results").setAttribute("aria-busy", String(testing));
  }

  function renderMetrics(m) {
    if (!m) return;
    if (currentMetrics && (m.port !== currentMetrics.port || (currentMetrics.httpReady && !m.httpReady))) {
      connectionReport = null;
    }
    currentMetrics = m;
    const up = $("m-uptime");
    if (up) up.textContent = m.status === "stopped" ? "—" : fmtUptime(m.uptimeMs);
    const clients = $("m-clients");
    if (clients) clients.textContent = m.clients == null ? "n/a" : String(m.clients);
    const requests = $("m-requests");
    if (requests) requests.textContent = m.requests == null ? "n/a" : String(m.requests);
    const endpoint = $("endpoint");
    if (endpoint) endpoint.textContent = "http://localhost:" + m.port + "/mcp";
    $("endpoint-container").textContent = "http://host.docker.internal:" + m.port + "/mcp";
    if (window.__bridgePort !== m.port) {
      window.__bridgePort = m.port;
      if (window.__refreshConnect) window.__refreshConnect();
    }
    renderConnection();
  }

  function applySettings(s) {
    if (!s) return;
    const port = $("port");
    if (port) port.value = String(s.port);
    const notif = $("notifications");
    if (notif) notif.checked = !!s.notifications;
    window.__bridgePort = s.port;
  }

  function showConflict(info) {
    conflictPid = info && typeof info.pid === "number" ? info.pid : null;
    const banner = $("conflict");
    const text = $("conflict-text");
    if (text) {
      const who = info && info.name ? info.name + " (pid " + info.pid + ")" : "another process";
      text.textContent = "Port is in use by " + who + ".";
    }
    if (banner) banner.classList.remove("hidden");
    const free = $("conflict-free");
    if (free) free.style.display = conflictPid == null ? "none" : "";
  }

  function hideConflict() {
    const banner = $("conflict");
    if (banner) banner.classList.add("hidden");
    conflictPid = null;
  }

  async function refreshDoctor() {
    const list = $("doctor-list");
    if (!list) return;
    list.textContent = "Running checks…";
    const results = await api.runDoctor();
    list.innerHTML = "";
    (results || []).forEach(function (r) {
      const row = document.createElement("div");
      row.className = "doctor-row";
      const badge = document.createElement("span");
      badge.className = "badge " + r.status;
      badge.textContent = ({ pass: "✓", warn: "!", fail: "✗" })[r.status] || "✗";
      const body = document.createElement("div");
      const dl = document.createElement("div");
      dl.className = "dl";
      dl.textContent = r.label;
      const dd = document.createElement("div");
      dd.className = "dd";
      dd.textContent = r.detail;
      body.appendChild(dl);
      body.appendChild(dd);
      row.appendChild(badge);
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  function wire() {
    $("test-connection").addEventListener("click", async function () {
      if (testing) return;
      const sequence = ++testSequence;
      testing = true;
      connectionReport = null;
      $("connection-error").classList.add("hidden");
      renderConnection();
      try {
        await api.testConnection();
      } catch (error) {
        if (sequence !== testSequence) return;
        $("connection-error").textContent = error.message || String(error);
        $("connection-error").classList.remove("hidden");
      } finally {
        if (sequence === testSequence) {
          testing = false;
          renderConnection();
        }
      }
    });

    const toggle = $("toggle-btn");
    if (toggle) {
      toggle.addEventListener("click", function () {
        const active = /Stop/.test(toggle.textContent);
        if (active) api.stop();
        else api.start();
      });
    }

    const copy = $("copy-logs");
    if (copy) {
      copy.addEventListener("click", async function () {
        try {
          await navigator.clipboard.writeText(logLines.join("\n"));
          const prev = copy.textContent;
          copy.textContent = "✓ Copied";
          setTimeout(() => (copy.textContent = prev), 1200);
        } catch {
          /* clipboard unavailable */
        }
      });
    }

    const port = $("port");
    if (port) {
      port.addEventListener("change", function () {
        const value = parseInt(port.value, 10);
        if (!Number.isNaN(value) && value > 0 && value < 65536) {
          api.saveSettings({ port: value });
          window.__bridgePort = value;
          if (window.__refreshConnect) window.__refreshConnect();
        }
      });
    }

    const notif = $("notifications");
    if (notif) {
      notif.addEventListener("change", function () {
        api.saveSettings({ notifications: notif.checked });
      });
    }

    const doctorBtn = $("doctor-btn");
    if (doctorBtn) {
      doctorBtn.addEventListener("click", function () {
        $("doctor-overlay").classList.remove("hidden");
        refreshDoctor();
      });
    }
    const doctorClose = $("doctor-close");
    if (doctorClose) doctorClose.addEventListener("click", () => $("doctor-overlay").classList.add("hidden"));
    const doctorRerun = $("doctor-rerun");
    if (doctorRerun) doctorRerun.addEventListener("click", refreshDoctor);
    const doctorFirewall = $("doctor-firewall");
    if (doctorFirewall) doctorFirewall.addEventListener("click", () => api.fixFirewall());
    const doctorOverlay = $("doctor-overlay");
    if (doctorOverlay) {
      doctorOverlay.addEventListener("click", function (e) {
        if (e.target === doctorOverlay) doctorOverlay.classList.add("hidden");
      });
    }

    const free = $("conflict-free");
    if (free) {
      free.addEventListener("click", function () {
        if (conflictPid != null) api.freePort();
        hideConflict();
      });
    }
    const dismiss = $("conflict-dismiss");
    if (dismiss) dismiss.addEventListener("click", hideConflict);
  }

  function subscribe() {
    api.onLog(appendLog);
    api.onStatus(function (status) {
      renderStatus(status);
      if (isActive(status)) hideConflict();
    });
    api.onMetrics(renderMetrics);
    api.onConnectionTest(function (report) {
      connectionReport = report;
      renderConnection();
    });
    api.onPortConflict(showConflict);
  }

  window.addEventListener("DOMContentLoaded", async function () {
    wire();
    subscribe();
    try {
      const state = await api.state();
      applySettings(state.settings);
      renderStatus(state.metrics.status);
      connectionReport = state.connectionTest || null;
      renderMetrics(state.metrics);
    } catch {
      /* main not ready yet */
    }
  });
})();
