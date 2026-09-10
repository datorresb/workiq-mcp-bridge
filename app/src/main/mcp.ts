import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface ConnectionCheck {
  status: "idle" | "checking" | "pass" | "fail";
  detail: string;
}

export interface ConnectionReport {
  port: number;
  http: ConnectionCheck;
  mcp: ConnectionCheck;
  m365: ConnectionCheck;
}

export function emptyConnectionReport(port: number): ConnectionReport {
  return {
    port,
    http: { status: "idle", detail: "Not checked" },
    mcp: { status: "idle", detail: "Not checked" },
    m365: { status: "idle", detail: "Not checked" },
  };
}

export async function probeMcp(
  port: number,
  signal?: AbortSignal,
  access?: { onMcpReady: (toolCount: number) => void }
): Promise<{ serverName: string; toolCount: number }> {
  const client = new Client({ name: "workiq-bridge-readiness", version: "1.0.2" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  const timeout = AbortSignal.timeout(120_000);
  const options = { timeout: 120_000, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
  try {
    await client.connect(transport, options);
    const result = await client.listTools({}, options);
    if (result.tools.length === 0) throw new Error("MCP returned no tools");
    if (access) {
      access.onMcpReady(result.tools.length);
      if (!result.tools.some((tool) => tool.name === "list_agents")) {
        throw new Error("WorkIQ does not expose list_agents");
      }
      const response = await client.callTool({ name: "list_agents", arguments: {} }, undefined, options);
      const content = response.content as Array<{ type: string; text?: string }> | undefined;
      const text = content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n") ?? "";
      if (response.isError) throw new Error(text.slice(0, 300) || "list_agents failed");
      let agents: unknown;
      try { agents = JSON.parse(text); }
      catch { throw new Error("list_agents did not return a valid agent list"); }
      if (!Array.isArray(agents)) throw new Error("list_agents did not return a valid agent list");
    }
    return { serverName: client.getServerVersion()!.name, toolCount: result.tools.length };
  } finally {
    await client.close();
  }
}

export async function testConnection(
  port: number,
  onUpdate: (report: ConnectionReport) => void,
  signal?: AbortSignal
): Promise<ConnectionReport> {
  let report = emptyConnectionReport(port);
  let stage: "http" | "mcp" | "m365" = "http";
  const update = (key: typeof stage, status: ConnectionCheck["status"], detail: string): void => {
    signal?.throwIfAborted();
    report = { ...report, [key]: { status, detail } };
    onUpdate(report);
  };
  try {
    update("http", "checking", "Checking...");
    const deadline = AbortSignal.timeout(5000);
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    await response.body?.cancel();
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    update("http", "pass", `Port ${port}`);
    stage = "mcp";
    update("mcp", "checking", "Initializing and listing tools...");
    await probeMcp(port, signal, {
      onMcpReady(toolCount) {
        update("mcp", "pass", `${toolCount} tools`);
        stage = "m365";
        update("m365", "checking", "Calling list_agents...");
      },
    });
    update("m365", "pass", "Basic access verified (list_agents)");
  } catch (error) {
    if (signal?.aborted) return emptyConnectionReport(port);
    update(stage, "fail", error instanceof Error ? error.message : String(error));
  }
  return report;
}