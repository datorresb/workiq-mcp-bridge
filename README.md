# workiq-mcp-bridge

Gateway between the [WorkIQ MCP](https://www.npmjs.com/package/@microsoft/workiq) server and a devcontainer.

WorkIQ MCP is stdio-only and requires host-machine registration for
authentication. This repository provides two ways to make it available inside a
devcontainer:

| | Approach | When to use |
|---|---|---|
| ✅ **Primary** | **stdio via VS Code user settings** | VS Code Desktop + devcontainer (standard case) |
| ⚠️ Fallback | HTTP bridge (`start-workiq-bridge.ps1 -ExposeToDocker`) | VS Code for the Web, non-VS-Code clients, multi-user shared host |

---

## Architecture comparison

### Option A — stdio (recommended)

VS Code spawns WorkIQ MCP as a host-side child process and proxies MCP
messages into the devcontainer over its internal devcontainer bridge. **No
network port is opened.**

```
Windows Host
┌──────────────────────────────────────────────────────────────────┐
│  VS Code (host process)                                          │
│    ├─ spawns: npx @microsoft/workiq mcp  (stdio child process)   │
│    │           ↕  stdin / stdout                                  │
│    └─ DevContainer bridge (internal, no network port)            │
│              ↕                                                   │
│         DevContainer                                             │
│         └─ Copilot Chat (consumes MCP tools)                     │
└──────────────────────────────────────────────────────────────────┘
```

Attack surface: **none** — no port is opened, no network listener exists.

### Option B — HTTP fallback

`supergateway` wraps the stdio WorkIQ MCP process and exposes it as an HTTP
endpoint. Docker containers reach the host via `host.docker.internal`.

```
Windows Host (port 3100)            DevContainer
┌──────────────────────────┐        ┌──────────────────────────┐
│ supergateway              │        │ VS Code / Copilot Chat   │
│   wraps WorkIQ MCP stdio  │◄──────│   connects via HTTP      │
│   exposes HTTP endpoint   │        │   host.docker.internal   │
└──────────────────────────┘        └──────────────────────────┘
```

Attack surface: **one inbound TCP port** on the Docker bridge network.

---

## Option A — stdio setup (recommended)

No script required. Add the following to your VS Code **user** `settings.json`
(open with `Ctrl+Shift+P` → *Preferences: Open User Settings (JSON)*):

```jsonc
{
  "mcp": {
    "servers": {
      "workiq": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@microsoft/workiq", "mcp"]
      }
    }
  }
}
```

See also [`examples/vscode-settings.json`](examples/vscode-settings.json).

VS Code will start WorkIQ MCP on demand as a host-side process.
Authentication uses the registration already present on your Windows host —
the devcontainer never needs its own credentials.

> **Why not `devcontainer.json`?**
> Placing an `mcp` block in `devcontainer.json` under
> `customizations.vscode.settings` tells VS Code to run the
> server *inside* the container, where WorkIQ's host registration is not
> available. User settings keep the process on the registered host.

---

## Option B — HTTP fallback

Use this only when stdio is genuinely not possible (see the table above).

### 1. First-time firewall setup (once)

```powershell
.\start-workiq-bridge.ps1 -ExposeToDocker -Firewall
```

This auto-elevates to Administrator — accept the UAC prompt.
The firewall rule is scoped to Docker Desktop's default bridge network (`172.17.0.0/16`).

### 2. Start the bridge

```powershell
.\start-workiq-bridge.ps1 -ExposeToDocker
```

Leave the terminal open. The bridge runs until you close it or press `Ctrl+C`.

### 3. Configure your devcontainer

Add this to your `devcontainer.json`:

```jsonc
{
  "customizations": {
    "vscode": {
      "settings": {
        "mcp": {
          "servers": {
            "workiq": {
              "url": "http://host.docker.internal:3100/mcp"
            }
          }
        }
      }
    }
  }
}
```

See also [`examples/devcontainer.json`](examples/devcontainer.json).

### Commands

| Command | Description |
|---------|-------------|
| `.\start-workiq-bridge.ps1` | Start on localhost only (no Docker access) |
| `.\start-workiq-bridge.ps1 -ExposeToDocker` | Start and allow Docker containers to connect |
| `.\start-workiq-bridge.ps1 -Port 4000 -ExposeToDocker` | Custom port |
| `.\start-workiq-bridge.ps1 -Stop` | Stop the bridge |
| `.\start-workiq-bridge.ps1 -Test` | Verify the bridge is healthy |
| `.\start-workiq-bridge.ps1 -ExposeToDocker -Firewall` | Add Windows Firewall rule (once) |

---

## Threat model

### Assets

| Asset | Description |
|-------|-------------|
| WorkIQ credentials | Host-machine OAuth token used by `@microsoft/workiq` |
| MCP tool invocations | Ability to create tasks, query work items, etc. |
| Host execution context | `npx` subprocess runs with the current user's privileges |

### Attackers and entry points

| Attacker | Entry point | Relevant to |
|----------|-------------|-------------|
| Malicious container code | `host.docker.internal` TCP connection | Option B only |
| Other local processes on the host | Loopback TCP connection | Option B (localhost mode) |
| Compromised devcontainer image | Container → host network | Option B only |
| Supply-chain attack on `@microsoft/workiq` or `supergateway` | `npx` execution | Both options |

### Threats and failure modes

| Threat | Impact | Mitigated? |
|--------|--------|------------|
| Unauthenticated container invokes WorkIQ tools | Creates/modifies work items on behalf of the user | ✅ Option A: not possible (no port). Option B: partially — firewall scoped to `172.17.0.0/16`, but **no per-request authentication** |
| HTTP bridge exposed to LAN/internet | Remote attacker invokes tools | ✅ Default bind is `127.0.0.1`; `-ExposeToDocker` binds to all interfaces with firewall scoped to Docker bridge |
| Token exfiltration via crafted MCP response | Credentials stolen | ✅ Option A: token never leaves the VS Code host process. Option B: token used inside supergateway subprocess, not sent over HTTP |
| `npx` executes a malicious package version | Arbitrary code execution on host | ⚠️ Pin package versions and audit with `npm audit` periodically |
| Port scanning reveals HTTP endpoint | Reconnaissance | ✅ Reduced by scoping firewall to `172.17.0.0/16` |

### Safeguards

- **Prefer Option A** (stdio). It eliminates the network attack surface entirely.
- **When using Option B**, always run with `-ExposeToDocker` explicitly — the
  default localhost-only mode is intentionally inaccessible to containers.
- The firewall rule created by `-Firewall` is scoped to `172.17.0.0/16`
  (Docker Desktop's default bridge) rather than `Any`, reducing lateral-movement
  risk. Custom Docker Compose networks may need a wider range — see the inline
  comment in the script.
- No credentials are stored in this repository or passed as script parameters.
- WorkIQ authentication is delegated entirely to the registered host process.

---

## Requirements

- Windows with Docker Desktop
- Node.js (for `npx`)
- WorkIQ MCP registered on your machine (`npx @microsoft/workiq`)
- VS Code with the Copilot Chat extension
- A devcontainer

---

## License

MIT

