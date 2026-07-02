// Renderer for the single-view WorkIQ Bridge Manager window. Plain browser
// script (no bundler). Talks to the main process only through window.bridgeAPI
// exposed by the preload script.
(function () {
  "use strict";

  const api = window.bridgeAPI;
  const MAX_LOG_LINES = 500;
  const logLines = [];
  let conflictPid = null;

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
    return status === "running" || status === "unhealthy" || status === "restarting";
  }

  function renderStatus(status) {
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
  }

  function renderMetrics(m) {
    if (!m) return;
    const health = $("m-health");
    if (health) {
      if (m.status === "running" && m.healthy) {
        health.textContent = "✓ OK";
        health.className = "v ok";
      } else if (m.status === "unhealthy") {
        health.textContent = "✗ Down";
        health.className = "v bad";
      } else {
        health.textContent = "—";
        health.className = "v";
      }
    }
    const up = $("m-uptime");
    if (up) up.textContent = m.status === "stopped" ? "—" : fmtUptime(m.uptimeMs);
    const clients = $("m-clients");
    if (clients) clients.textContent = m.clients == null ? "n/a" : String(m.clients);
    const requests = $("m-requests");
    if (requests) requests.textContent = m.requests == null ? "n/a" : String(m.requests);
    const endpoint = $("endpoint");
    if (endpoint) endpoint.textContent = "http://localhost:" + m.port + "/mcp";
    if (window.__bridgePort !== m.port) {
      window.__bridgePort = m.port;
      if (window.__refreshConnect) window.__refreshConnect();
    }
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
    api.onPortConflict(showConflict);
  }

  window.addEventListener("DOMContentLoaded", async function () {
    wire();
    subscribe();
    try {
      const state = await api.state();
      applySettings(state.settings);
      renderStatus(state.metrics.status);
      renderMetrics(state.metrics);
    } catch {
      /* main not ready yet */
    }
  });
})();
