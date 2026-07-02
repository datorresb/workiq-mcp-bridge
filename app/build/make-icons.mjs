// Icon generator for WorkIQ MCP Bridge.
// Designs a suspension-bridge mark (host <-> container link) as SVG, rasterizes
// to multi-size PNGs with sharp, and assembles Windows .ico files.
//   node build/make-icons.mjs
import sharp from "sharp";
import pngToIco from "png-to-ico";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const GREEN = "#56d364";
const TEAL = "#58a6ff";
const GRAY = "#8b949e";
const RED = "#ff7b72";

// The M glow: a double-hump arc that links a host node (left circle) to a
// container node (right rounded square). The arc alone is the mark -- no towers,
// deck, or suspenders. `arc` colors the curve; `left`/`right` the two nodes.
const ARC = "M48 170 C 74 170 84 86 98 80 C 118 106 138 106 158 80 C 172 86 182 170 208 170";

function glyph({ arc, left, right, width = 12 }) {
  return `
    <path d="${ARC}" fill="none" stroke="${arc}" stroke-width="${width}" stroke-linecap="round"/>
    <circle cx="48" cy="170" r="16" fill="${left}"/>
    <rect x="192" y="154" width="32" height="32" rx="9" fill="${right}"/>`;
}

function appIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="#222a35"/>
        <stop offset="1" stop-color="#0b0e13"/>
      </linearGradient>
      <!-- green (host) flows into blue (container) so the arc merges both nodes -->
      <linearGradient id="arc" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${GREEN}"/>
        <stop offset="0.55" stop-color="#59c3a0"/>
        <stop offset="1" stop-color="${TEAL}"/>
      </linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="7"/>
      </filter>
    </defs>
    <rect x="8" y="8" width="240" height="240" rx="54" fill="url(#tile)" stroke="#2f3742" stroke-width="2"/>
    <rect x="9" y="9" width="238" height="118" rx="53" fill="#ffffff" opacity="0.03"/>
    <!-- soft neon halo -->
    <g filter="url(#glow)" opacity="0.65">${glyph({ arc: "url(#arc)", left: GREEN, right: TEAL })}</g>
    <!-- crisp mark -->
    ${glyph({ arc: "url(#arc)", left: GREEN, right: TEAL })}
  </svg>`;
}

function trayGlyphSvg(color) {
  // One state color (green/gray/red), transparent bg, glow -> reads at 16px.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <filter id="tglow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5"/>
      </filter>
    </defs>
    <g transform="translate(0,6) scale(0.96)">
      <g filter="url(#tglow)" opacity="0.5">${glyph({ arc: color, left: color, right: color, width: 13 })}</g>
      ${glyph({ arc: color, left: color, right: color, width: 13 })}
    </g>
  </svg>`;
}

async function renderPng(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

async function writeIco(svg, sizes, outPath) {
  const pngs = await Promise.all(sizes.map((s) => renderPng(svg, s)));
  const ico = await pngToIco(pngs);
  await fs.writeFile(outPath, ico);
  return ico.length;
}

async function main() {
  const appSizes = [16, 24, 32, 48, 64, 128, 256];
  const traySizes = [16, 24, 32];

  const app = appIconSvg();
  await fs.writeFile(path.join(here, "icon.svg"), app);
  const n1 = await writeIco(app, appSizes, path.join(here, "icon.ico"));

  const trays = [
    ["tray-green.ico", GREEN],
    ["tray-gray.ico", GRAY],
    ["tray-red.ico", RED],
  ];
  const results = [];
  for (const [file, color] of trays) {
    const n = await writeIco(trayGlyphSvg(color), traySizes, path.join(here, file));
    results.push(`${file} (${n}b)`);
  }

  // A PNG preview for eyeballing the design.
  await fs.writeFile(path.join(here, "icon-preview.png"), await renderPng(app, 256));

  console.log(`icon.ico (${n1}b), ${results.join(", ")}, icon-preview.png`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
