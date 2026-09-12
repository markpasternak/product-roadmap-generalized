import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve('src/styles/appearance.css'), 'utf8');
const products = ['music-app', 'podcasts-audiobooks', 'spotify-for-artists', 'ads-platform', 'core-platform-data'];

function rgb(hex: string): number[] {
  return hex.match(/[\da-f]{2}/gi)!.map(channel => parseInt(channel, 16));
}
function mix(foreground: number[], background: number[], amount: number): number[] {
  return foreground.map((channel, index) => channel * amount + background[index] * (1 - amount));
}
function luminance(color: number[]): number {
  const linear = color.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a: number[], b: number[]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}
function themeBlock(theme: 'light' | 'dark'): string {
  if (theme === 'light') return css.slice(css.indexOf(':root:root {'), css.indexOf(":root:root[data-theme='dark']"));
  return css.slice(css.indexOf(":root:root[data-theme='dark']"));
}
function color(block: string, token: string): number[] {
  const value = block.match(new RegExp(`--${token}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`Missing ${token}`);
  return rgb(value);
}

describe('product shorthand contrast', () => {
  it.each(['light', 'dark'] as const)('keeps every %s product mark at WCAG AA contrast', theme => {
    const block = themeBlock(theme);
    const card = color(block, 'color-card');
    for (const product of products) {
      const foreground = color(block, `roadmap-product-${product}`);
      expect(contrast(foreground, mix(foreground, card, 0.1)), `${theme} ${product}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
