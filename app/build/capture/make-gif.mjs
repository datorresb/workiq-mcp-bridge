// Renders the real renderer UI (src/renderer/index.html) with a mock bridge,
// drives it through a scripted sequence, captures frames via capturePage(), and
// encodes an animated GIF for the README. Build-time only.
//   (from app/) node_modules/electron/dist/electron.exe build/capture/make-gif.mjs
import { app, BrowserWindow } from "electron";
import gifenc from "gifenc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = path.join(here, "..", "..", "src", "renderer", "index.html");
const outGif = path.join(here, "..", "demo.gif");

const GIF_WIDTH = 680;
const STEP_MS = 140;
const TOTAL_MS = 5600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { GIFEncoder, quantize, applyPalette } = gifenc;

function bgraToRgba(bgra) {
  const out = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    out[i] = bgra[i + 2];
    out[i + 1] = bgra[i + 1];
    out[i + 2] = bgra[i];
    out[i + 3] = bgra[i + 3];
  }
  return out;
}

function paletteSample(frames) {
  const pick = [frames[3], frames[Math.floor(frames.length / 2)], frames[frames.length - 2]].filter(
    Boolean
  );
  const total = pick.reduce((n, f) => n + f.rgba.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const f of pick) {
    buf.set(f.rgba, off);
    off += f.rgba.length;
  }
  return buf;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 760,
    height: 470,
    x: -4000,
    y: 0,
    show: true,
    frame: false,
    skipTaskbar: true,
    backgroundColor: "#0f1115",
    useContentSize: true,
    webPreferences: {
      preload: path.join(here, "capture-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(indexHtml);
  await sleep(500);

  const clicks = [
    [200, "document.getElementById('toggle-btn').click()"],
    [3000, "document.getElementById('connect-btn').click()"],
    [4700, "document.getElementById('connect-close').click()"],
  ];
  for (const [t, js] of clicks) {
    setTimeout(() => win.webContents.executeJavaScript(js).catch(() => {}), t);
  }

  const frames = [];
  for (let elapsed = 0; elapsed <= TOTAL_MS; elapsed += STEP_MS) {
    const img = (await win.webContents.capturePage()).resize({ width: GIF_WIDTH });
    const size = img.getSize();
    frames.push({ rgba: bgraToRgba(img.toBitmap()), w: size.width, h: size.height });
    await sleep(STEP_MS);
  }

  const enc = GIFEncoder();
  const palette = quantize(paletteSample(frames), 128);
  for (const f of frames) {
    const index = applyPalette(f.rgba, palette);
    enc.writeFrame(index, f.w, f.h, { palette, delay: STEP_MS });
  }
  enc.finish();
  fs.writeFileSync(outGif, Buffer.from(enc.bytes()));
  console.log(`GIF written: ${outGif} (${(fs.statSync(outGif).size / 1024).toFixed(0)} KB, ${frames.length} frames, ${frames[0].w}x${frames[0].h})`);
  app.quit();
});
