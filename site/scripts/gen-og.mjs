// Generates the dark, editorial Open Graph card used by both the roadmap site
// (Base.astro) and minted public shares (render.ts bundles a copy alongside
// index.html). Deterministic, one-time asset: run this manually and commit the
// PNG — it is not regenerated at build/CI time.
//
// Font caveat: this script rasterizes an SVG with sharp (libvips + librsvg).
// librsvg resolves `font-family` through fontconfig on the *host machine* — it
// does not honor `@font-face { src: url(data:...) }` for custom faces (tested:
// an embedded base64 Source Serif Pro/Inter silently fell back to a generic
// system font). So rather than ship an embedded font that quietly fails, this
// card deliberately uses the same fallback fonts the site's own CSS declares
// for when the brand webfonts aren't available — Georgia/Times New Roman for
// the serif display face, Helvetica Neue/Arial for sans — which *are*
// resolvable via fontconfig on macOS and Linux CI alike.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;

// Brand tokens, pulled from src/styles/global.css / primitives.css (dark theme).
const NAVY = '#101a2b';
const ACCENT = '#12857c';
const ACCENT_LIGHT = '#3fb3a6';
const IVORY = '#f5f2ec';
const MUTED = 'rgba(240,244,252,0.68)';
const FAINT = 'rgba(240,244,252,0.4)';
const HORIZON_NOW = '#73d49a';
const HORIZON_NEXT = '#f0b863';
const HORIZON_LATER = 'rgba(233,244,242,0.58)';

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Arial, sans-serif";

// The product mark (accent rounded-square + three narrowing horizon bars),
// identical to the favicon in Base.astro and ui/BrandMark.vue — kept as vector
// so no raster or font asset is needed.
const LOGO_VIEWBOX = 415;
const logoMark = (x, y, size) => {
  const s = size / LOGO_VIEWBOX;
  return `
  <g transform="translate(${x} ${y}) scale(${s})">
    <rect width="415" height="415" rx="41.5" fill="${ACCENT}"/>
    <rect x="88" y="120" width="239" height="44" rx="22" fill="#fff"/>
    <rect x="88" y="186" width="172" height="44" rx="22" fill="#fff" fill-opacity="0.82"/>
    <rect x="88" y="252" width="105" height="44" rx="22" fill="#fff" fill-opacity="0.6"/>
  </g>`;
};

const horizonDot = (cx, cy, color) => `<circle cx="${cx}" cy="${cy}" r="7" fill="${color}"/>`;

function buildSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.32"/>
      <stop offset="45%" stop-color="${ACCENT}" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-accent-light" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${ACCENT_LIGHT}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${ACCENT_LIGHT}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${NAVY}"/>
  <ellipse cx="980" cy="60" rx="520" ry="440" fill="url(#glow)"/>
  <ellipse cx="120" cy="620" rx="380" ry="260" fill="url(#glow-accent-light)"/>
  <circle cx="1010" cy="360" r="360" fill="none" stroke="rgba(233,244,242,0.06)" stroke-width="1.5"/>
  <circle cx="1010" cy="360" r="270" fill="none" stroke="rgba(233,244,242,0.045)" stroke-width="1"/>

  <!-- Brand lockup -->
  ${logoMark(100, 92, 76)}
  <text x="198" y="146" font-family="${SANS}" font-weight="700" font-size="24" letter-spacing="6" fill="${MUTED}">PRODUCT PORTFOLIO</text>
  <rect x="100" y="196" width="52" height="4" rx="2" fill="${ACCENT}"/>

  <!-- Headline -->
  <text x="96" y="368" font-family="${SERIF}" font-weight="400" font-size="168" fill="${IVORY}">Roadmap</text>

  <!-- Now / Next / Later legend -->
  ${horizonDot(112, 448, HORIZON_NOW)}
  <text x="130" y="457" font-family="${SANS}" font-weight="500" font-size="34" letter-spacing="0.5" fill="${IVORY}">Now</text>
  <text x="222" y="457" font-family="${SANS}" font-weight="400" font-size="34" fill="${FAINT}">·</text>
  ${horizonDot(258, 448, HORIZON_NEXT)}
  <text x="276" y="457" font-family="${SANS}" font-weight="500" font-size="34" letter-spacing="0.5" fill="${IVORY}">Next</text>
  <text x="384" y="457" font-family="${SANS}" font-weight="400" font-size="34" fill="${FAINT}">·</text>
  ${horizonDot(420, 448, HORIZON_LATER)}
  <text x="438" y="457" font-family="${SANS}" font-weight="500" font-size="34" letter-spacing="0.5" fill="${IVORY}">Later</text>

  <text x="98" y="512" font-family="${SANS}" font-weight="400" font-size="25" fill="${MUTED}">What's shipping, what's next, what's not yet scoped.</text>
</svg>`;
}

async function main() {
  const svg = buildSvg();
  const svgPath = fileURLToPath(new URL('./og-card.svg', import.meta.url));
  writeFileSync(svgPath, svg, 'utf8');

  const outPath = fileURLToPath(new URL('../public/brand/og-card.png', import.meta.url));
  const png = await sharp(Buffer.from(svg)).png({ quality: 92 }).toBuffer();
  const info = await sharp(png).metadata();
  if (info.width !== WIDTH || info.height !== HEIGHT) {
    throw new Error(`gen-og: expected ${WIDTH}x${HEIGHT}, got ${info.width}x${info.height}`);
  }
  writeFileSync(outPath, png);
  console.log(`gen-og: wrote ${outPath} (${info.width}x${info.height}, ${png.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
