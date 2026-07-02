import { execFile } from "child_process";
import { isPortInUse } from "./port";

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

const FIREWALL_RULE = "WorkIQ MCP Bridge (Docker)";

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (error, stdout) => {
      resolve({ ok: !error, out: (stdout || "").trim() });
    });
  });
}

async function checkNpx(): Promise<CheckResult> {
  const r = await run("cmd.exe", ["/c", "npx --version"]);
  return {
    id: "npx",
    label: "Node / npx available",
    status: r.ok && r.out.length > 0 ? "pass" : "fail",
    detail: r.ok ? `npx ${r.out}` : "npx was not found on PATH",
  };
}

async function checkFirewall(): Promise<CheckResult> {
  const r = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `if (Get-NetFirewallRule -DisplayName "${FIREWALL_RULE}" -ErrorAction SilentlyContinue) { "yes" } else { "no" }`,
  ]);
  const present = r.out.includes("yes");
  return {
    id: "firewall",
    label: "Firewall rule for Docker",
    status: present ? "pass" : "warn",
    detail: present
      ? "Inbound rule present"
      : "Rule missing — needed for devcontainer access. Use “Fix firewall”.",
  };
}

async function checkPort(port: number): Promise<CheckResult> {
  const inUse = await isPortInUse(port);
  return {
    id: "port",
    label: `Port ${port} availability`,
    status: inUse ? "warn" : "pass",
    detail: inUse ? `Port ${port} is currently in use` : `Port ${port} is free`,
  };
}

function checkWorkiq(): CheckResult {
  // WorkIQ registration lives on the host and cannot be verified cheaply
  // without triggering a download; surface it as a manual reminder.
  return {
    id: "workiq",
    label: "WorkIQ host registration",
    status: "warn",
    detail: "Ensure WorkIQ is registered on this machine (run `npx @microsoft/workiq` once).",
  };
}

export async function runDoctor(port: number): Promise<CheckResult[]> {
  const [npx, firewall, port_] = await Promise.all([
    checkNpx(),
    checkFirewall(),
    checkPort(port),
  ]);
  return [npx, checkWorkiq(), firewall, port_];
}

/** Add the Windows firewall inbound rule, elevating via UAC. */
export function fixFirewall(port: number): void {
  const inner =
    `if (-not (Get-NetFirewallRule -DisplayName "${FIREWALL_RULE}" -ErrorAction SilentlyContinue)) { ` +
    `New-NetFirewallRule -DisplayName "${FIREWALL_RULE}" -Direction Inbound -LocalPort ${port} ` +
    `-Protocol TCP -Action Allow -Description "Allow Docker containers to reach the WorkIQ MCP bridge" | Out-Null }`;
  const encoded = Buffer.from(inner, "utf16le").toString("base64");
  execFile(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
    ],
    { windowsHide: true },
    () => {
      /* elevation launched; result is user-driven via UAC */
    }
  );
}
