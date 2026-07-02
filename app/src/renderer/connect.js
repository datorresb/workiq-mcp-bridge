// Connect panel: builds host + devcontainer snippets from the current port and
// wires the click-to-open, copy-to-clipboard behavior. Plain browser script
// (no bundler); reads window.__bridgePort set by renderer.js.
(function () {
  "use strict";

  function currentPort() {
    const p = window.__bridgePort;
    return typeof p === "number" && p > 0 ? p : 3100;
  }

  function snippetFor(host, port) {
    return (
      '"mcp": {\n' +
      '  "servers": {\n' +
      '    "workiq": { "url": "http://' + host + ":" + port + '/mcp" }\n' +
      "  }\n" +
      "}"
    );
  }

  function render() {
    const port = currentPort();
    const host = document.getElementById("snippet-host");
    const cont = document.getElementById("snippet-cont");
    if (host) host.textContent = snippetFor("localhost", port);
    if (cont) cont.textContent = snippetFor("host.docker.internal", port);
  }

  function open() {
    render();
    const overlay = document.getElementById("connect-overlay");
    if (overlay) overlay.classList.remove("hidden");
  }

  function close() {
    const overlay = document.getElementById("connect-overlay");
    if (overlay) overlay.classList.add("hidden");
  }

  async function copyFrom(id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.textContent || "");
      const prev = btn.textContent;
      btn.textContent = "✓ Copied";
      setTimeout(() => (btn.textContent = prev), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  window.addEventListener("DOMContentLoaded", function () {
    const openBtn = document.getElementById("connect-btn");
    const closeBtn = document.getElementById("connect-close");
    const overlay = document.getElementById("connect-overlay");

    if (openBtn) openBtn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });
    }

    document.querySelectorAll(".copy").forEach(function (btn) {
      btn.addEventListener("click", function () {
        copyFrom(btn.getAttribute("data-target"), btn);
      });
    });
  });

  // expose for renderer to refresh snippets when the port changes
  window.__refreshConnect = render;
})();
