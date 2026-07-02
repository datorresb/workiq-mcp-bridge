# Smoke harness

Staged, incremental stubs that validate one layer at a time. Build first
(`npm run build`), then run each stub in order — get each green before relying
on the feature above it.

| Stub | Proves | Needs |
|---|---|---|
| `00_handshake.mjs` | The MCP `initialize` POST returns HTTP 200 (deep liveness). | A running bridge on the port. |
| `01_spawn.mjs` | Start/stop the process tree; the port is released after stop (no orphans). | Build only. |
| `02_watchdog.mjs` | An unexpected crash restarts; a manual stop does not. | Build only. |
| `03_health-loop.mjs` | `/healthz` ✓/✗ transitions are emitted. | A running bridge on the port. |

Usage:

```bash
npm run build
node smoke/01_spawn.mjs           # start/stop + orphan check
node smoke/02_watchdog.mjs        # crash-restart vs manual-stop
# with a bridge already running on :3100:
node smoke/00_handshake.mjs
node smoke/03_health-loop.mjs
```

Each stub exits `0` on success and non-zero on failure.

For interactive MCP tool verification through the bridge, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```
