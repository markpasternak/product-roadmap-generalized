const COVER_POSITION = /^(?:100|\d{1,2})% (?:100|\d{1,2})%$/;

/** One focal-point contract for live cards, readers, item pages, and baked shares. */
export function normalizeCoverPosition(value?: string | null): string {
  return COVER_POSITION.test(value ?? '') ? value! : '50% 50%';
}

/** Art direction shared by every cover placement. Zero is the normal edge-to-edge crop,
 * negative values reveal more of the source image, and positive values move closer. */
export function normalizeCoverFraming(value?: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.max(-1, Math.min(1, parsed)) * 100) / 100;
}

export function coverFramingLabel(value?: number | string | null): string {
  const framing = normalizeCoverFraming(value);
  if (framing <= -0.85) return 'Show full image';
  if (framing < -0.05) return 'Reveal more';
  if (framing <= 0.05) return 'Fill card';
  return 'Close-up';
}

/** CSS variables drive the same fitted/filled transition in Vue, Astro and baked HTML. */
export function coverPresentationStyle(position?: string | null, value?: number | string | null): Record<string, string> {
  const framing = normalizeCoverFraming(value);
  const revealOpacity = framing < 0 ? Math.min(1, Math.max(0, -framing / 0.15)) : 0;
  return {
    '--cover-position': normalizeCoverPosition(position),
    '--cover-fill-scale': String(1 + Math.max(0, framing) * 0.65),
    '--cover-reveal-scale': String(1 + Math.max(0, framing + 1) * 0.14),
    '--cover-fill-opacity': String(1 - revealOpacity),
    '--cover-reveal-opacity': String(revealOpacity),
    '--cover-backdrop-opacity': String(revealOpacity * 0.78),
  };
}

export function coverPresentationCss(position?: string | null, value?: number | string | null): string {
  return Object.entries(coverPresentationStyle(position, value)).map(([key, cssValue]) => `${key}:${cssValue}`).join(';');
}
