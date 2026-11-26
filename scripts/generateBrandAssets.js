/**
 * Generates every brand identity asset from the canonical BrandMark geometry:
 * - frontend/public/favicon.svg (adaptive light/dark)
 * - frontend/public/favicon-16.png, favicon-32.png, favicon.ico
 * - frontend/public/apple-touch-icon.png (180x180)
 * - frontend/public/icon-192.png, icon-512.png, icon-512-maskable.png
 * - frontend/public/og-image.png (1200x630 editorial social card)
 * - frontend/public/fonts/bricolage-grotesque-latin-wght-normal.woff2
 * - frontend/public/diagrams/*.webp (optimized real output previews for the landing marquee)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderBrandMarkSvg } from "../frontend/src/brand/markGeometry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "frontend", "public");
const DOCS_ASSETS = path.join(ROOT, "docs", "assets");

/**
 * Packages PNG buffers into a standard multi-resolution Windows ICO container.
 * Supported natively by Vista+ and all modern browsers.
 * @param {Array<{ width: number, height: number, png: Buffer }>} images
 */
function buildIcoFromPngs(images) {
  const headerSize = 6;
  const entrySize = 16;
  let offset = headerSize + entrySize * images.length;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(images.length, 4);

  const directory = [];
  for (const img of images) {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += img.png.length;
    directory.push(entry);
  }

  return Buffer.concat([header, ...directory, ...images.map((i) => i.png)]);
}

function buildOgCardSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="ogBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#12100e" />
      <stop offset="62%" stop-color="#0a2926" />
      <stop offset="100%" stop-color="#0f766e" />
    </linearGradient>
    <pattern id="dotGrid" width="32" height="32" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.3" fill="#ffffff" fill-opacity="0.07" />
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="url(#ogBg)" />
  <rect width="1200" height="630" fill="url(#dotGrid)" />

  <!-- Top left BrandMark + Wordmark -->
  <g transform="translate(88, 84)">
    <g transform="scale(1.9)">
      <rect width="32" height="32" rx="8" fill="#0d9488" stroke="#2dd4bf" stroke-opacity="0.45" stroke-width="1" />
      <rect x="6" y="6" width="10" height="8" rx="2" fill="#ffffff" />
      <rect x="16" y="18" width="10" height="8" rx="2" fill="#ffffff" />
      <path d="M16 10H20A2 2 0 0 1 22 12V18" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M10 14V20A2 2 0 0 0 12 22H16" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="23" cy="9" r="2.2" fill="#fbbf24" />
    </g>
    <text x="80" y="42" fill="#fafaf9" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="34" font-weight="700" letter-spacing="-0.02em">Visualify</text>
  </g>

  <!-- Main headline & subtitle -->
  <text x="88" y="246" fill="#ffffff" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="60" font-weight="800" letter-spacing="-0.03em">Turn messy notes into</text>
  <text x="88" y="318" fill="#5eead4" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="60" font-weight="800" letter-spacing="-0.03em">editable visual maps.</text>
  <text x="88" y="378" fill="#d6d3d1" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="24" font-weight="400">
    AI-planned flowcharts, mind maps, timelines &amp; Excalidraw
  </text>
  <text x="88" y="412" fill="#d6d3d1" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="24" font-weight="400">
    canvases — paired with quizzes, flashcards &amp; study sheets.
  </text>

  <!-- Feature pills -->
  <g transform="translate(88, 466)" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="18" font-weight="600">
    <rect width="190" height="44" rx="22" fill="#0f766e" stroke="#2dd4bf" stroke-opacity="0.4" />
    <text x="95" y="28" text-anchor="middle" fill="#ccfbf1">Excalidraw Canvas</text>

    <rect x="206" width="166" height="44" rx="22" fill="#1c1917" stroke="#57534e" />
    <text x="289" y="28" text-anchor="middle" fill="#f5f5f4">PDF &amp; Image In</text>

    <rect x="388" width="194" height="44" rx="22" fill="#1c1917" stroke="#f59e0b" stroke-opacity="0.5" />
    <text x="485" y="28" text-anchor="middle" fill="#fde68a">Quiz &amp; Flashcards</text>
  </g>

  <!-- Decorative live diagram preview card on the right -->
  <g transform="translate(760, 120)">
    <rect width="360" height="400" rx="20" fill="#1c1917" fill-opacity="0.9" stroke="#2dd4bf" stroke-opacity="0.32" stroke-width="1.5" />
    <rect x="24" y="24" width="110" height="24" rx="12" fill="#0f766e" fill-opacity="0.4" />
    <circle cx="42" cy="36" r="5" fill="#2dd4bf" />
    <text x="56" y="41" fill="#99f6e4" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="12" font-weight="600">FLOWCHART</text>

    <!-- Diagram nodes & edges -->
    <rect x="108" y="84" width="144" height="46" rx="10" fill="#0f766e" stroke="#5eead4" stroke-width="1.5" />
    <text x="180" y="112" text-anchor="middle" fill="#ffffff" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="15" font-weight="600">Input Source</text>

    <path d="M180 130 V162" stroke="#5eead4" stroke-width="2.5" stroke-linecap="round" />
    <path d="M180 162 L110 184" stroke="#5eead4" stroke-width="2.5" stroke-linecap="round" />
    <path d="M180 162 L250 184" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" />

    <rect x="34" y="186" width="132" height="50" rx="10" fill="#292524" stroke="#78716c" stroke-width="1.5" />
    <text x="100" y="216" text-anchor="middle" fill="#fafaf9" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="14" font-weight="600">Plan &amp; Group</text>

    <rect x="194" y="186" width="132" height="50" rx="10" fill="#292524" stroke="#f59e0b" stroke-width="1.5" />
    <text x="260" y="216" text-anchor="middle" fill="#fef3c7" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="14" font-weight="600">Edit Nodes</text>

    <path d="M100 236 V270 H260 V236" fill="none" stroke="#5eead4" stroke-opacity="0.7" stroke-width="2" />
    <path d="M180 270 V302" stroke="#5eead4" stroke-width="2.5" stroke-linecap="round" />

    <rect x="70" y="302" width="220" height="58" rx="12" fill="#312e81" fill-opacity="0.55" stroke="#818cf8" stroke-width="1.5" />
    <text x="180" y="330" text-anchor="middle" fill="#e0e7ff" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="15" font-weight="700">Interactive Study Pack</text>
    <text x="180" y="348" text-anchor="middle" fill="#a5b4fc" font-family="Inter, Segoe UI, system-ui, sans-serif" font-size="12">Quiz · Cards · Revision Sheet</text>
  </g>
</svg>`;
}

async function generate() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.mkdirSync(path.join(PUBLIC_DIR, "fonts"), { recursive: true });
  fs.mkdirSync(path.join(PUBLIC_DIR, "diagrams"), { recursive: true });

  // 1. Canonical dark-aware SVG favicon
  const faviconSvg = renderBrandMarkSvg({ size: 32, darkAware: true, title: "Visualify" });
  fs.writeFileSync(path.join(PUBLIC_DIR, "favicon.svg"), faviconSvg, "utf8");

  // Crisp non-CSS SVG source for rasterization via sharp/librsvg
  const rasterSvg512 = Buffer.from(
    renderBrandMarkSvg({ size: 512, darkAware: false, title: "Visualify", backdropColor: "#0f766e" }),
    "utf8"
  );
  const maskableSvg512 = Buffer.from(
    renderBrandMarkSvg({
      size: 512,
      darkAware: false,
      title: "Visualify",
      scale: 0.68,
      backdropColor: "#0f766e",
    }),
    "utf8"
  );
  const appleTouchSvg = Buffer.from(
    renderBrandMarkSvg({
      size: 180,
      darkAware: false,
      title: "Visualify",
      scale: 0.78,
      backdropColor: "#0f766e",
    }),
    "utf8"
  );

  // 2. Raster PNG icons + multi-res ICO
  const png16 = await sharp(rasterSvg512).resize(16, 16).png({ compressionLevel: 9 }).toBuffer();
  const png32 = await sharp(rasterSvg512).resize(32, 32).png({ compressionLevel: 9 }).toBuffer();
  const apple180 = await sharp(appleTouchSvg).resize(180, 180).png({ compressionLevel: 9 }).toBuffer();
  const png192 = await sharp(rasterSvg512).resize(192, 192).png({ compressionLevel: 9 }).toBuffer();
  const png512 = await sharp(rasterSvg512).resize(512, 512).png({ compressionLevel: 9 }).toBuffer();
  const maskable512 = await sharp(maskableSvg512).resize(512, 512).png({ compressionLevel: 9 }).toBuffer();

  fs.writeFileSync(path.join(PUBLIC_DIR, "favicon-16.png"), png16);
  fs.writeFileSync(path.join(PUBLIC_DIR, "favicon-32.png"), png32);
  fs.writeFileSync(
    path.join(PUBLIC_DIR, "favicon.ico"),
    buildIcoFromPngs([
      { width: 16, height: 16, png: png16 },
      { width: 32, height: 32, png: png32 },
    ])
  );
  fs.writeFileSync(path.join(PUBLIC_DIR, "apple-touch-icon.png"), apple180);
  fs.writeFileSync(path.join(PUBLIC_DIR, "icon-192.png"), png192);
  fs.writeFileSync(path.join(PUBLIC_DIR, "icon-512.png"), png512);
  fs.writeFileSync(path.join(PUBLIC_DIR, "icon-512-maskable.png"), maskable512);

  // 3. Social card OG image (1200x630)
  const ogBuffer = await sharp(Buffer.from(buildOgCardSvg(), "utf8"))
    .resize(1200, 630)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  fs.writeFileSync(path.join(PUBLIC_DIR, "og-image.png"), ogBuffer);

  // 4. Copy self-hosted display font subset (latin woff2 only) so <link rel="preload"> matches @font-face cleanly
  const fontSrc = path.join(
    ROOT,
    "node_modules",
    "@fontsource-variable",
    "bricolage-grotesque",
    "files",
    "bricolage-grotesque-latin-wght-normal.woff2"
  );
  const fontDest = path.join(PUBLIC_DIR, "fonts", "bricolage-grotesque-latin-wght-normal.woff2");
  if (!fs.existsSync(fontSrc)) {
    throw new Error(`Missing font asset at ${fontSrc}. Run npm install first.`);
  }
  fs.copyFileSync(fontSrc, fontDest);

  // 5. Convert real documentation diagrams to lightweight WebP thumbnails for the landing marquee
  const diagramFiles = ["diagram-mindmap.png", "diagram-sequence.png", "diagram-er.png", "diagram-comparison.png"];
  for (const name of diagramFiles) {
    const srcPath = path.join(DOCS_ASSETS, name);
    if (!fs.existsSync(srcPath)) continue;
    const outName = name.replace(/\.png$/, ".webp");
    await sharp(srcPath)
      .resize({ width: 960, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(PUBLIC_DIR, "diagrams", outName));
  }

  console.log("[brand:assets] Generated favicons, PWA icons, OG image, self-hosted font, and diagram WebP previews.");
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
