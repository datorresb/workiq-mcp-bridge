# Smoke harness

Staged, incremental stubs that validate one layer at a time. Build first
(`npm run build`), then run each stub in order — get each green before relying
on the feature above it.

| Stub | Proves | Needs |
|---|---|---|
| `00_handshake.mjs` | MCP initialization and non-empty tool discovery succeed, not just HTTP 200. | Build and a running bridge on the port. |
| `01_spawn.mjs` | Start/stop the process tree; the port is released after stop (no orphans). | Build only. |
| `02_watchdog.mjs` | An unexpected crash restarts; a manual stop does not. | Build only. |
| `03_health-loop.mjs` | `/healthz` ✓/✗ transitions are emitted. | A running bridge on the port. |
| `10_restart-policy.mjs` | Restart backoff, cap, and reset. | Build only. |
| `11_readiness.mjs` | Starting/Running states, MCP failures, canceled checks, Doctor output, and duplicate/late manual tests. | Installed dependencies; no live WorkIQ. |
| `12_gateway.mjs` | Canceled-client recovery, readiness validation, and staged HTTP/MCP/M365 tests including tool errors and malformed responses. | Build and installed dependencies; uses a synthetic stdio MCP. |
| `13_packaged-ui.mjs` | Packaged UI + IPC: Start, Test connection, Doctor port ownership, and Stop. Also supports the actual portable launcher. | Node 22+ and a packaged app; calls real WorkIQ `list_agents`. |
| `14_tray-icons.cjs` | The shipped tray ICOs decode in Electron, contain visible pixels, and can be assigned to a native tray. | Installed Electron and a directory containing the three tray ICOs. |

Doctor regressions in `11_readiness.mjs` cover free, own, foreign and unknown port owners, plus active versus configured ports. `13_packaged-ui.mjs` verifies the running gateway's port is shown as OK in the real Doctor UI and is free after Stop.

Usage:

```bash
npm run build
npm test                        # builds and runs 11 + 12 on isolated fixtures
node smoke/01_spawn.mjs           # start/stop + orphan check
node smoke/02_watchdog.mjs        # crash-restart vs manual-stop
# with a bridge already running on :3100:
node smoke/00_handshake.mjs
node smoke/03_health-loop.mjs
```

Each stub exits `0` on success and non-zero on failure.

The readiness probe uses the MCP SDK to handle JSON-RPC and SSE responses, with a two-minute deadline for the complete probe. The app repeats it only after Start or an observed HTTP outage; normal polling remains an inexpensive HTTP health check. The supergateway patch in `../patches/` is reapplied by install/build and included in the packaged app.

Optional packaged UI check, separate from `npm test`:

```powershell
node smoke/13_packaged-ui.mjs "dist-package/1.0.4/WorkIQ MCP Bridge-1.0.4-portable.exe"
```

It uses an isolated temporary profile and a free port, leaves existing app instances alone, and closes its test instance after stopping the bridge. It does not query emails or documents. Its temporary profile is retained for troubleshooting; only the test launch enables a debugging endpoint.

The portable test waits for the extracted app's debugging endpoint using a filesystem event, then checks the same window and IPC as the unpacked test. The launch deadline is three minutes to accommodate extraction. Run the portable path above when verifying distribution, not only the executable under `win-unpacked`.

Native tray resource check after packaging:

```powershell
node node_modules/electron/cli.js smoke/14_tray-icons.cjs dist-package/1.0.3/win-unpacked/resources/tray
```

The test creates and removes its own tray icon; it does not start WorkIQ or affect the running bridge. Development reads icons from `build/`; packaged apps read `resources/tray/` supplied by `extraResources`.

## README GIF

With the real Electron app running and CDP enabled as described in [../AGENTS.md](../AGENTS.md), run from `app/`:

```powershell
node build/capture/make-gif.mjs http://127.0.0.1:9222
```

The generator drives Test connection, Doctor, and the connection panel through Playwright MCP. It does not use the legacy mock preload. It temporarily hides logs before taking any screenshot, disables automatic MCP snapshots, and rejects unexpected result/configuration text. It restores the normal view afterwards and leaves the running bridge alone.

Output is a candidate GIF and six PNG frames in a temporary folder printed by the command. Inspect **every frame**, including the decoded GIF, for personal data and legibility before replacing `build/demo.gif`. Never publish raw logs, MCP session output, or unreviewed captures. Only the reviewed GIF belongs in the README. The fixed frame delays shorten waiting time; they are not latency measurements.

For interactive MCP tool verification through the bridge, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```
