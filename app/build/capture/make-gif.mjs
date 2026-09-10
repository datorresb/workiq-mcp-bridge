import gifenc from "gifenc";
import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const captures = fs.mkdtempSync(path.join(os.tmpdir(), "workiq-gif-"));
const { GIFEncoder, quantize, applyPalette } = gifenc;

async function main() {
  const client = new Client({ name: "workiq-readme-capture", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npx-cli.js"),
      "-y", "@playwright/mcp@0.0.80", "--cdp-endpoint", endpoint,
      "--snapshot-mode", "none", "--console-level", "error", "--output-dir", captures],
    cwd: path.resolve(here, "..", ".."), env: process.env, stderr: "ignore",
  });
  const frames = [];
  let prepared = false;

  async function call(name, args) {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    if (response.isError) throw new Error(`Capture stopped at ${name}; raw output withheld for privacy`);
    return response;
  }
  const evaluate = (expression) => call("browser_evaluate", { function: `() => ${expression}` });
  const click = (target) => call("browser_click", { target });
  async function waitFor(condition) {
    await evaluate(`new Promise((resolve, reject) => {
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Capture state timeout')); }, 150000);
      function check() { if (${condition}) { clearTimeout(timer); observer.disconnect(); resolve(true); } }
      observer.observe(document.body, {subtree:true, childList:true, attributes:true, characterData:true});
      check();
    })`);
  }
  async function capture(name, delay) {
    await evaluate(`(() => {
      if (getComputedStyle(document.querySelector('.logs-wrap')).display !== 'none') throw new Error('Logs are visible');
      const allowed = /^(|Not checked|Checking\\.\\.\\.|Port \\d+|\\d+ tools|Initializing and listing tools\\.\\.\\.|Calling list_agents\\.\\.\\.|Basic access verified \\(list_agents\\))$/;
      for (const detail of document.querySelectorAll('.check-detail')) {
        if (!allowed.test(detail.textContent)) throw new Error('Unexpected connection detail; do not capture');
      }
      for (const detail of document.querySelectorAll('#doctor-list .dd')) {
        if (!/^(npx [0-9.]+|Inbound rule present|Port \\d+ is used by this bridge)$/.test(detail.textContent)) throw new Error('Unexpected environment detail; do not capture');
      }
      for (const code of document.querySelectorAll('.code')) {
        if (!code.textContent) continue;
        const parsed = JSON.parse('{' + code.textContent + '}');
        const url = parsed.mcp?.servers?.workiq?.url;
        if (!/^http:\\/\\/(localhost|host\\.docker\\.internal):\\d+\\/mcp$/.test(url)) throw new Error('Unexpected endpoint; do not capture');
        if (JSON.stringify(parsed) !== JSON.stringify({mcp:{servers:{workiq:{url}}}})) throw new Error('Unexpected configuration; do not capture');
      }
    })()`);
    const response = await call("browser_take_screenshot", {
      scale: "css", type: "png", filename: path.join(captures, `${name}.png`), fullPage: false,
    });
    const image = response.content.find((item) => item.type === "image");
    const png = image ? Buffer.from(image.data, "base64") : fs.readFileSync(path.join(captures, `${name}.png`));
    const { data, info } = await sharp(png)
      .resize({ width: 800 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (frames.length && info.height !== frames[0].height) throw new Error("Capture dimensions changed");
    frames.push({ rgba: data, width: info.width, height: info.height, delay });
    console.log(`Captured ${name}; logs excluded`);
  }

  try {
    console.log("Connecting Playwright MCP to real Electron (automatic snapshots disabled)");
    await client.connect(transport, { timeout: 60000 });
    await client.listTools();
    await evaluate(`(async () => {
      if (document.title !== 'WorkIQ MCP Bridge' || !window.bridgeAPI) throw new Error('Wrong capture target');
      const state = await window.bridgeAPI.state();
      if (state.metrics.status !== 'running') throw new Error('Start the real bridge before capture');
      if (Object.values(state.connectionTest).some(value => value?.status === 'checking')) throw new Error('Another connection test is active');
      for (const id of ['doctor-overlay','connect-overlay']) {
        if (!document.getElementById(id).classList.contains('hidden')) throw new Error('Close open panels before capture');
      }
      const style = document.createElement('style');
      style.id = 'gif-capture-privacy';
      style.textContent = '.logs-wrap { display:none !important; }';
      document.head.appendChild(style);
    })()`);
    prepared = true;
    await capture("01-running", 1800);
    await click("#test-connection");
    await capture("02-testing", 1600);
    await waitFor("!document.getElementById('test-connection').disabled");
    await evaluate(`(() => {
      for (const key of ['http','mcp','m365']) {
        if (document.getElementById('check-'+key+'-status').textContent !== 'OK') throw new Error('Connection test failed; do not capture');
      }
    })()`);
    await capture("03-verified", 3000);
    await click("#doctor-btn");
    await waitFor("document.querySelectorAll('#doctor-list .doctor-row').length === 3");
    await capture("04-doctor", 3000);
    await click("#doctor-close");
    await click("#connect-btn");
    await capture("05-connect", 4500);
    await click("#connect-close");
    await capture("06-ready", 2000);

    const encoder = GIFEncoder();
    const palette = quantize(Buffer.concat(frames.map((frame) => frame.rgba)), 128);
    for (const frame of frames) {
      encoder.writeFrame(applyPalette(frame.rgba, palette), frame.width, frame.height, {
        palette, delay: frame.delay, repeat: 0,
      });
    }
    encoder.finish();
    const gif = Buffer.from(encoder.bytes());
    const metadata = await sharp(gif, { animated: true }).metadata();
    if (metadata.pages !== frames.length || metadata.width !== 800) throw new Error("Invalid GIF output");
    const candidate = path.join(captures, "demo-candidate.gif");
    fs.writeFileSync(candidate, gif);
    console.log(JSON.stringify({ candidate, bytes: gif.length, frames: metadata.pages, width: metadata.width,
      height: metadata.pageHeight, delays: metadata.delay, captures, reviewRequired: true }));
  } finally {
    if (prepared) {
      try {
        await evaluate(`(() => {
          document.getElementById('gif-capture-privacy')?.remove();
          document.getElementById('doctor-close').click();
          document.getElementById('connect-close').click();
        })()`);
      } catch { console.error("Restore the capture privacy style/panels in the Electron window if still present"); }
    }
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
