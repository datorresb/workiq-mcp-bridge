# powershell -File C:\Users\davidto\Desktop\WorkIQ\scripts\start-workiq-bridge.ps1
<#
.SYNOPSIS
    Exposes WorkIQ MCP to devcontainers via supergateway (stdio → streamable HTTP).

.DESCRIPTION
    WorkIQ MCP is stdio-only and requires host machine registration.
    This script bridges it to an HTTP endpoint so devcontainers can connect
    through host.docker.internal without separate registration.

    First-time setup (once):
      .\scripts\start-workiq-bridge.ps1 -Firewall

    Daily use:
      .\scripts\start-workiq-bridge.ps1

    DevContainer MCP config (devcontainer.json):
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

.PARAMETER Port
    Port to listen on (default: 3100).

.PARAMETER Stop
    Stop the running bridge.

.PARAMETER Test
    Verify the bridge is healthy.

.PARAMETER Firewall
    Add a Windows Firewall inbound rule for Docker. Auto-elevates to Admin.

.EXAMPLE
    .\scripts\start-workiq-bridge.ps1
    Starts the bridge on port 3100.

.EXAMPLE
    .\scripts\start-workiq-bridge.ps1 -Port 4000
    Starts the bridge on a custom port.

.EXAMPLE
    .\scripts\start-workiq-bridge.ps1 -Stop
    Stops whatever is listening on port 3100.
#>
param(
    [int]$Port = 3100,
    [switch]$Stop,
    [switch]$Test,
    [switch]$Firewall
)

$ErrorActionPreference = "Stop"
$RuleName = "WorkIQ MCP Bridge (Docker)"

# ── Firewall ────────────────────────────────────────────────────────────────────
if ($Firewall) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "Requesting Administrator privileges..." -ForegroundColor Cyan
        Start-Process powershell -Verb RunAs -ArgumentList "-File `"$PSCommandPath`" -Firewall -Port $Port"
        exit 0
    }
    if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
        Write-Host "Firewall rule already exists." -ForegroundColor Yellow
        exit 0
    }
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow -Description "Allow Docker containers to reach the WorkIQ MCP bridge" | Out-Null
    Write-Host "Firewall rule created for port $Port." -ForegroundColor Green
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

Write-Host "Starting WorkIQ MCP bridge on port $Port..." -ForegroundColor Cyan
Write-Host "Endpoint: http://localhost:$Port/mcp"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

npx -y supergateway --stdio "npx -y @microsoft/workiq mcp" --port $Port --outputTransport streamableHttp
