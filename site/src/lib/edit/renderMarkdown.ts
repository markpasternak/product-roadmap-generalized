// Safe client-side markdown → HTML for the structured section editor's rendered
// (non-editing) display. `marked` parses GFM markdown; `DOMPurify` sanitizes the
// result before it's ever handed to `v-html`, so a `<script>`, an `onerror=`, a
// `javascript:` href, or any other raw HTML that ended up in a section's stored
// markdown is stripped rather than executed.
//
// DOMPurify needs a real DOM to sanitize against — it walks and prunes an actual
// document tree, which only makes sense here because this render exclusively runs
// client-side, in a real browser, when a section isn't being edited. Astro's
// `client:load` island still does an initial SSR pass on the server (no DOM there)
// before hydrating, so importing this module must not crash that pass, and any
// accidental server-side call must degrade gracefully instead of throwing
// "DOMPurify.sanitize is not a function" — its factory export is a bare function
// until it's bound to a `window`, which doesn't exist during prerender.
import { marked } from 'marked';
import createDOMPurify from 'dompurify';

type Purifier = { sanitize: (html: string) => string };

// Lazily bound to `window` on first use rather than at module-eval time, so loading
// this module never touches `window` in an environment that doesn't have one.
let purifier: Purifier | null | undefined;

function getPurifier(): Purifier | null {
  if (purifier !== undefined) return purifier;
  purifier = typeof window === 'undefined' ? null : (createDOMPurify(window) as Purifier);
  return purifier;
}

export function renderMarkdown(md: string): string {
  const purify = getPurifier();
  // No DOM (server prerender pass) — we can't sanitize, so NEVER emit raw HTML.
  // Escape the source so nothing can execute (defense-in-depth; this path shouldn't
  // reach a reader since the editor only mounts after client-side hydration).
  if (!purify) return md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return purify.sanitize(marked.parse(md, { gfm: true, breaks: true }) as string);
}
