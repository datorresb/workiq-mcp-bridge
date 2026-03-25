# workiq-mcp-bridge

Expose the stdio-only [WorkIQ MCP](https://www.npmjs.com/package/@microsoft/workiq) server to devcontainers via [supergateway](https://github.com/supercorp-ai/supergateway).

WorkIQ requires host machine registration for authentication. This script bridges it to an HTTP endpoint so devcontainers can connect through `host.docker.internal` — no extra registration needed.

```
Windows Host (port 3100)          DevContainer
┌──────────────────────┐          ┌─────────────────────────┐
│ supergateway          │          │ VS Code + Copilot Chat  │
│   wraps WorkIQ MCP   │◄────────│   connects via HTTP     │
│   stdio → HTTP       │          │   host.docker.internal  │
└──────────────────────┘          └─────────────────────────┘
```

## Quick Start

### 1. First-time setup (once)

Open the firewall for Docker:

```powershell
.\start-workiq-bridge.ps1 -Firewall
```

This auto-elevates to Administrator — accept the UAC prompt.

### 2. Start the bridge

```powershell
.\start-workiq-bridge.ps1
```

Leave this terminal open. The bridge runs until you close it or press `Ctrl+C`.

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

Rebuild your container and WorkIQ MCP tools will be available in Copilot Chat.

## Commands

| Command | Description |
|---------|-------------|
| `.\start-workiq-bridge.ps1` | Start the bridge (default port 3100) |
| `.\start-workiq-bridge.ps1 -Port 4000` | Use a custom port |
| `.\start-workiq-bridge.ps1 -Stop` | Stop the bridge |
| `.\start-workiq-bridge.ps1 -Test` | Verify the bridge is healthy |
| `.\start-workiq-bridge.ps1 -Firewall` | Add Windows Firewall rule (once) |

## How It Works

- **supergateway** wraps WorkIQ's stdio MCP protocol and exposes it as streamable HTTP on `localhost:3100/mcp`
- Docker containers reach the host via `host.docker.internal`
- A Windows Firewall inbound rule allows traffic from Docker's virtual network
- Authentication stays on your registered Windows host — the container never needs its own registration

## Requirements

- Windows with Docker Desktop
- Node.js (for `npx`)
- WorkIQ MCP registered on your machine (`npx @microsoft/workiq`)
- A devcontainer

## License

MIT
