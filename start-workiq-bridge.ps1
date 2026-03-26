<#
.SYNOPSIS
    HTTP fallback bridge: exposes WorkIQ MCP to devcontainers via supergateway
    (stdio → streamable HTTP).

.DESCRIPTION
    PREFERRED APPROACH — stdio via VS Code user settings (no script needed):
    =========================================================================
    Add this to your VS Code *user* settings.json (not devcontainer settings):

      "mcp": {
        "servers": {
          "workiq": {
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "@microsoft/workiq", "mcp"]
          }
        }
      }

    VS Code spawns WorkIQ as a host-side child process and proxies the MCP
    protocol into the devcontainer automatically — no ports, no firewall rules.

    FALLBACK — HTTP bridge (this script):
    ======================================
    Use this script only when the stdio approach is not viable (e.g. VS Code for
    the Web, multi-user shared host, or a non-VS-Code devcontainer client).

    By default the HTTP bridge binds to 127.0.0.1 only (localhost).
    Pass -ExposeToDocker to also accept connections from Docker's virtual
    network (172.x.x.x) and add the required Windows Firewall rule.

    SECURITY NOTICE: -ExposeToDocker opens an inbound firewall port. Only use
    this when the stdio approach is genuinely not possible, and ensure no
    untrusted processes can reach the Docker bridge network.

    First-time Docker setup (once, only if using -ExposeToDocker):
      .\start-workiq-bridge.ps1 -ExposeToDocker -Firewall

    Daily use — localhost only (safest):
      .\start-workiq-bridge.ps1

    Daily use — also accessible from devcontainers:
      .\start-workiq-bridge.ps1 -ExposeToDocker

.PARAMETER Port
    Port to listen on (default: 3100).

.PARAMETER ExposeToDocker
    Bind to 0.0.0.0 instead of 127.0.0.1, allowing Docker containers to
    connect via host.docker.internal. Requires a Firewall rule (see -Firewall).

.PARAMETER Stop
    Stop the running bridge.

.PARAMETER Test
    Verify the bridge is healthy.

.PARAMETER Firewall
    Add a Windows Firewall inbound rule for Docker. Auto-elevates to Admin.
    Only meaningful together with -ExposeToDocker.

.EXAMPLE
    .\start-workiq-bridge.ps1
    Starts the bridge on 127.0.0.1:3100 (localhost only — safest).

.EXAMPLE
    .\start-workiq-bridge.ps1 -ExposeToDocker
    Starts the bridge on 0.0.0.0:3100 so devcontainers can reach it.

.EXAMPLE
    .\start-workiq-bridge.ps1 -Port 4000 -ExposeToDocker
    Uses a custom port and exposes to Docker.

.EXAMPLE
    .\start-workiq-bridge.ps1 -Stop
    Stops whatever is listening on port 3100.
#>
param(
    [int]$Port = 3100,
    [switch]$ExposeToDocker,
    [switch]$Stop,
    [switch]$Test,
    [switch]$Firewall
)

$ErrorActionPreference = "Stop"
$RuleName = "WorkIQ MCP Bridge (Docker)"

# ── Firewall ────────────────────────────────────────────────────────────────────
if ($Firewall) {
    if (-not $ExposeToDocker) {
        Write-Host "WARNING: -Firewall only applies when using -ExposeToDocker." -ForegroundColor Yellow
        Write-Host "The preferred stdio approach requires no firewall changes." -ForegroundColor Yellow
        exit 0
    }
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "Requesting Administrator privileges..." -ForegroundColor Cyan
        Start-Process powershell -Verb RunAs -ArgumentList "-File `"$PSCommandPath`" -Firewall -ExposeToDocker -Port $Port"
        exit 0
    }
    if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
        Write-Host "Firewall rule already exists." -ForegroundColor Yellow
        exit 0
    }
    # Scope the rule to Docker Desktop's default bridge network (172.17.0.0/16).
    # Docker Compose may allocate subnets elsewhere within 172.16.0.0/12; if you
    # use custom networks, pass the correct CIDR with -RemoteAddress when running
    # New-NetFirewallRule manually, or widen this to 172.16.0.0/12.
    New-NetFirewallRule `
        -DisplayName $RuleName `
        -Direction Inbound `
        -LocalPort $Port `
        -Protocol TCP `
        -Action Allow `
        -RemoteAddress "172.17.0.0/16" `
        -Description "Allow Docker bridge network to reach the WorkIQ MCP HTTP fallback bridge" | Out-Null
    Write-Host "Firewall rule created for port $Port (Docker bridge 172.17.0.0/16 only)." -ForegroundColor Green
    exit 0
}

# ── Stop ────────────────────────────────────────────────────────────────────────
if ($Stop) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        Write-Host "Nothing running on port $Port." -ForegroundColor Yellow
        exit 0
    }
    $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Stopping $($proc.ProcessName) (PID: $_)..." -ForegroundColor Cyan
            Stop-Process -Id $_ -Force
        }
    }
    Write-Host "Stopped." -ForegroundColor Green
    exit 0
}

# ── Test ────────────────────────────────────────────────────────────────────────
if ($Test) {
    $ok = $true
    Write-Host "Testing bridge on port $Port..." -ForegroundColor Cyan

    # Port check
    $tcp = New-Object System.Net.Sockets.TcpClient
    try { $tcp.Connect("127.0.0.1", $Port); $tcp.Close(); Write-Host "  Port $Port is open." -ForegroundColor Green }
    catch { Write-Host "  Port $Port is not open." -ForegroundColor Red; $ok = $false }

    # MCP handshake
    try {
        $body = '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}'
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/mcp" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { Write-Host "  MCP endpoint responds." -ForegroundColor Green }
        else { Write-Host "  MCP endpoint returned $($r.StatusCode)." -ForegroundColor Red; $ok = $false }
    } catch { Write-Host "  MCP endpoint unreachable." -ForegroundColor Red; $ok = $false }

    if ($ok) { Write-Host "`nBridge is healthy." -ForegroundColor Green } else { Write-Host "`nBridge has issues." -ForegroundColor Red }
    exit ([int](-not $ok))
}

# ── Start ───────────────────────────────────────────────────────────────────────
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Host "ERROR: Port $Port is already in use. Use -Stop to kill it." -ForegroundColor Red
    exit 1
}

if ($ExposeToDocker) {
    Write-Host ""
    Write-Host "SECURITY NOTICE" -ForegroundColor Yellow
    Write-Host "  The HTTP bridge is listening on all interfaces (0.0.0.0:$Port)." -ForegroundColor Yellow
    Write-Host "  Any process that can reach this host on port $Port can invoke" -ForegroundColor Yellow
    Write-Host "  WorkIQ MCP tools without authentication." -ForegroundColor Yellow
    Write-Host "  Use the stdio approach (VS Code user settings) whenever possible." -ForegroundColor Yellow
    Write-Host ""
    $bindHost = "0.0.0.0"
} else {
    Write-Host ""
    Write-Host "NOTE: Bridge is bound to localhost only." -ForegroundColor Cyan
    Write-Host "      Devcontainers cannot reach it. Use -ExposeToDocker to enable that." -ForegroundColor Cyan
    Write-Host "      For devcontainers, the stdio approach (VS Code user settings) is safer." -ForegroundColor Cyan
    Write-Host ""
    $bindHost = "127.0.0.1"
}

Write-Host "Starting WorkIQ MCP HTTP fallback bridge on ${bindHost}:${Port}..." -ForegroundColor Cyan
Write-Host "Endpoint: http://${bindHost}:${Port}/mcp"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

npx -y supergateway --stdio "npx -y @microsoft/workiq mcp" --port $Port --host $bindHost --outputTransport streamableHttp
