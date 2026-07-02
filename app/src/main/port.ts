import * as net from "net";
import { execFile } from "child_process";
import treeKill from "tree-kill";

function tryConnect(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false)); // ECONNREFUSED => nothing there
    socket.connect(port, host);
  });
}

/**
 * True when something is already listening on the port. Probes both loopback
 * families (IPv4 127.0.0.1 and IPv6 ::1) because supergateway may bind IPv6
 * only — a bind-based check on a single family misses that listener.
 */
export async function isPortInUse(port: number): Promise<boolean> {
  const [v4, v6] = await Promise.all([
    tryConnect("127.0.0.1", port),
    tryConnect("::1", port),
  ]);
  return v4 || v6;
}

export interface PortHolder {
  pid: number;
  name: string;
}

/** Identify the process listening on a port (Windows, via Get-NetTCPConnection). */
export function findPortHolder(port: number): Promise<PortHolder | null> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1; ` +
          `if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; "$($c.OwningProcess)|$($p.Name)" }`,
      ],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        const [pidStr, name] = ((stdout || "").trim().split(/\r?\n/)[0] ?? "").split("|");
        const pid = parseInt(pidStr, 10);
        if (err || Number.isNaN(pid)) {
          resolve(null);
          return;
        }
        resolve({ pid, name: (name || "").trim() || "unknown" });
      }
    );
  });
}

/** Kill whatever holds the port (used to free a stale bridge). */
export function freePort(pid: number): Promise<void> {
  return new Promise((resolve) => treeKill(pid, "SIGKILL", () => resolve()));
}
