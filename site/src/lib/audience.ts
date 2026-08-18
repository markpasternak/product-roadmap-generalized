// Build audience: 'internal' (default, everything) or 'public' (SITE_AUDIENCE=public;
// Public items only, no owners, internal-only sections stripped). Injected at build
// time via vite `define` in astro.config.mjs; the typeof guard covers vitest.
declare const __SITE_AUDIENCE__: string | undefined;

export const AUDIENCE: 'internal' | 'public' =
  typeof __SITE_AUDIENCE__ !== 'undefined' && __SITE_AUDIENCE__ === 'public' ? 'public' : 'internal';

export const IS_PUBLIC = AUDIENCE === 'public';
