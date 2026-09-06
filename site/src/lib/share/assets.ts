import serifUrl from '../../styles/fonts/SourceSerifPro-Regular.ttf?url';
import interUrl from '../../styles/fonts/Inter-Regular.woff2?url';
import mediumUrl from '../../styles/fonts/Inter-Medium.woff2?url';
import semiboldUrl from '../../styles/fonts/Inter-SemiBold.woff2?url';

/** Paths inside a published snapshot, shared by its CSS and ZIP manifest. */
export const SHARE_ASSET_PATHS = {
  serif: 'assets/SourceSerifPro-Regular.ttf',
  inter: 'assets/Inter-Regular.woff2',
  medium: 'assets/Inter-Medium.woff2',
  semibold: 'assets/Inter-SemiBold.woff2',
  logo: 'assets/roadmap-logo.svg',
} as const;
export type ShareAssetUrls = Record<keyof typeof SHARE_ASSET_PATHS, string>;

/** Preview uses the app's own assets; published HTML uses the same files locally. */
export function previewAssetUrls(base = import.meta.env.BASE_URL): ShareAssetUrls {
  return { serif: serifUrl, inter: interUrl, medium: mediumUrl, semibold: semiboldUrl, logo: `${base}brand/roadmap-logo.svg` };
}

export async function fetchShareAssets(base: string): Promise<Record<string, Uint8Array>> {
  const urls = previewAssetUrls(base);
  const entries = await Promise.all(Object.entries(SHARE_ASSET_PATHS).map(async ([key, path]) => {
    const response = await fetch(urls[key as keyof ShareAssetUrls]);
    if (!response.ok) throw new Error('Could not load the share’s design assets. Please try again.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Could not load the share’s design assets. Please reload the roadmap and try again.');
    }
    return [path, bytes] as const;
  }));
  return Object.fromEntries(entries);
}

/** A sandboxed srcdoc has an opaque origin. Inline assets avoid font CORS failures. */
export async function inlinePreviewAssets(): Promise<ShareAssetUrls> {
  const files = await fetchShareAssets(import.meta.env.BASE_URL);
  const entries = Object.entries(SHARE_ASSET_PATHS).map(([key, path]) => {
    const bytes = files[path]!;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    const mime = path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : path.endsWith('.ttf') ? 'font/ttf' : 'font/woff2';
    return [key, `data:${mime};base64,${btoa(chunks.join(''))}`];
  });
  return Object.fromEntries(entries) as ShareAssetUrls;
}
