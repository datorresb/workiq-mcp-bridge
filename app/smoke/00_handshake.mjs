import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { probeMcp } = require("../dist/main/mcp.js");
const port = Number(process.argv[2] || 3100);
const url = `http://localhost:${port}/mcp`;

try {
  const result = await probeMcp(port);
  console.log(`PASS: ${url} -> ${result.serverName}, ${result.toolCount} tools`);
} catch (error) {
  console.error(`FAIL: ${url}: ${error.message}`);
  process.exit(1);
}
