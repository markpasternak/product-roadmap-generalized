import { Marked, Renderer } from "marked";
import { repositoryAssetPath, resourceHref, isImageResource } from "./resources";
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
function safeHref(href: string) {
  return /^(?:https?:\/\/|mailto:|#|\/(?!\/)|\.\.?\/)/i.test(href) ? href : "";
}
/** Portable GFM with escaped raw HTML and a single URL policy for server and client. */
export function renderRichMarkdown(
  markdown: string,
  base = "/",
  overrides: Record<string, string> = {},
  allowHTML = false,
): string {
  const renderer = new Renderer();
  const resolved = (href: string) => {
    const path = repositoryAssetPath(href);
    return path && path in overrides
      ? overrides[path]!
      : safeHref(resourceHref(href, base));
  };
  renderer.html = ({ text }) => (allowHTML ? text : escape(text));
  renderer.link = function ({ href, tokens }) {
    const url = resolved(href);
    const label = this.parser.parseInline(tokens);
    if (!url) return label;
    const asset = repositoryAssetPath(href);
    const thumbnail = asset && isImageResource(href) && !tokens.some(t => t.type === 'image')
      ? `<img class="resource-link-thumbnail" src="${escape(url)}" alt="" loading="lazy" decoding="async">` : '';
    const link = `<a href="${escape(url)}"${/^https?:/.test(url) ? ' target="_blank" rel="noopener noreferrer"' : ""}${asset ? ' class="resource-file-link"' : ""}>${thumbnail}${label}</a>`;
    return asset && /\.(mp4|webm)$/i.test(asset)
      ? `<video controls preload="metadata" src="${escape(url)}" aria-label="Attached video"></video>${link}`
      : link;
  };
  renderer.image = ({ href, text }) => {
    const url = resolved(href);
    if (!url) return escape(text);
    return `<span class="resource-inline-image"><img src="${escape(url)}" alt="${escape(text)}" loading="lazy" decoding="async"></span>`;
  };
  return new Marked({ renderer, gfm: true, breaks: true }).parse(
    markdown,
  ) as string;
}
