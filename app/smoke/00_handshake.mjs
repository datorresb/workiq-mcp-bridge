// Smoke 00 — MCP initialize handshake must return HTTP 200 against a running
// bridge. Cheapest liveness signal; run with the bridge already up.
//   node smoke/00_handshake.mjs [port]
const port = Number(process.argv[2] || 3100);
const url = `http://localhost:${port}/mcp`;

try {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 200) {
    console.log(`PASS: ${url} -> 200`);
    process.exit(0);
  }
  console.error(`FAIL: ${url} -> ${res.status}`);
  process.exit(1);
} catch (e) {
  console.error(`FAIL: ${url} unreachable — ${e.message}`);
  process.exit(1);
}
