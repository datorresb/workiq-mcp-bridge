# WorkIQ Bridge App

## Preferred Debugging Workflow

- For UI debugging and acceptance checks, prefer the real Electron app from source controlled by the official Playwright MCP over CDP. Do not rebuild the portable for every iteration.
- Do not substitute the renderer HTML in VS Code's integrated browser with mocked `bridgeAPI` responses for a real app test. Mocked UI tests are supplemental and must be labeled as simulated.
- Before launching, check for an existing Electron/bridge instance and listeners. Reuse a suitable debug instance; do not terminate the user's app or start a conflicting bridge. Use an isolated profile and a free bridge port when necessary.

Run from this `app/` directory with dependencies installed:

```powershell
npm run build
node node_modules/electron/cli.js . --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
```

Connect a separate Playwright MCP session to that Electron instance:

```powershell
npx -y @playwright/mcp@0.0.80 --cdp-endpoint http://127.0.0.1:9222
```

- Port `9222` is local debugging, not the bridge's MCP endpoint on `3100`. If occupied, choose a free debug port and use it in both commands. Keep debugging loopback-only and out of normal production launch settings.
- Playwright MCP can be configured in the chat client or invoked through an MCP SDK client using stdio. Inspect its advertised tool schemas instead of assuming parameter names; the verified version accepts `target` selectors for clicks/screenshots.
- Use `browser_tabs` and `browser_snapshot` to confirm the target is the real Electron window. Use `browser_click` for Start, Test connection, Doctor and Stop; use `browser_evaluate` for state assertions and event-based waits, and `browser_take_screenshot` for evidence.
- Verify real IPC/backend results: Running, HTTP response, MCP tool discovery, and optional basic M365 access through `list_agents`. A successful `list_agents` call does not prove `ask` or every tool works. Do not query personal emails/documents just to test connectivity.
- Capture the actual connection panel, avoiding sensitive log payloads. Generated `.playwright-mcp/` output and screenshots are test artifacts, not source to commit automatically.
- Clean up only instances started for the test unless the user wants the app left open; state clearly what remains running.

## Final Verification

- Run focused regressions, or `npm test` for the full automated suite. See [smoke/README.md](smoke/README.md) for the existing helpers.
- For packaging/release work, also launch the actual portable and test its extracted app. Passing source Electron or `win-unpacked` tests does not prove portable extraction works.
- Reuse `smoke/13_packaged-ui.mjs` for real packaged UI/IPC/Doctor checks and `smoke/14_tray-icons.cjs` for native tray resources. Browser automation cannot directly inspect the Windows tray.
- Report which layers were actually tested: simulated HTML, source Electron, unpacked executable, or actual portable. Do not present one as another.