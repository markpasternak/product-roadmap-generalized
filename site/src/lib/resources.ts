import { marked, type Token } from "marked";

export interface ResourceFile {
  path: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}
export interface ResourceRevision {
  id: string;
  original: ResourceFile;
  createdAt: string;
  createdBy: string;
}
export interface ResourceAsset {
  schemaVersion: 1;
  id: string;
  name: string;
  visibility: "Internal" | "Public";
  revisions: ResourceRevision[];
  sha?: string;
  usages?: string[];
}
export interface ResourceUpload {
  uploadId: string;
  assetId: string;
  name: string;
  repoPath: string;
  revision: ResourceRevision;
  expiresAt: string;
  published: boolean;
}
export interface ResourcePlacement {
  start: number;
  end: number;
  raw: string;
  href: string;
  label: string;
  image: boolean;
  section: string;
}

export function repositoryAssetPath(href: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(href);
  } catch {
    return null;
  }
  const match = value.match(
    /^(?:\.\.\/\.\.\/|content\/|\/)assets\/(ast_[a-z0-9_-]+)\/(rev_[a-z0-9_-]+)\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)$/,
  );
  return match ? `content/assets/${match[1]}/${match[2]}/${match[3]}` : null;
}
export function resourceHref(href: string, base = "/") {
  const p = repositoryAssetPath(href);
  if (p) return `${base.replace(/\/$/, "")}/${p.slice("content/".length)}`;
  const doc = href.match(
    /(?:^|\/)(prds|technical-design|research)\/(?:.*\/)?([^/]+)\.md$/,
  );
  return doc
    ? `${base.replace(/\/$/, "")}/docs/${doc[1] === "prds" ? "prd" : doc[1]}/${doc[2].toLowerCase()}`
    : href;
}
export function markdownAssetPath(repoPath: string) {
  return `../../${repoPath.replace(/^content\//, "")}`;
}
export function readableBytes(bytes: number) {
  return bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}
export function markdownLabel(label: string) {
  return label.replace(/[\\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ");
}
/** Extension detection is only a display hint, never upload validation. */
export function isImageResource(href: string) {
  return /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(href);
}

export function resourcePlacements(body: string): ResourcePlacement[] {
  const tokens = marked.lexer(body);
  const result: ResourcePlacement[] = [];
  let section = "";
  function visit(list: any[], from: number) {
    let cursor = from;
    for (const token of list) {
      const start = body.indexOf(token.raw ?? "", cursor);
      if (start < 0) continue;
      cursor = start + (token.raw?.length ?? 0);
      if (token.type === "heading" && token.depth === 2) section = token.text;
      if (
        token.type === "list_item" &&
        ["Resources", "Links"].includes(section)
      ) {
        const legacy = /^[-*] +([^:\n]+): +(\S[^\n]*)$/.exec(
          token.raw.trimEnd(),
        );
        if (
          legacy &&
          /^(https?:\/\/|\.\.?\/|\/|presentations\/|p\/|content\/|prds\/|technical-design\/|research\/)/i.test(
            legacy[2],
          )
        ) {
          const labelStart = start + token.raw.indexOf(legacy[1]);
          result.push({
            start: labelStart,
            end: start + token.raw.trimEnd().length,
            raw: token.raw.slice(labelStart - start).trimEnd(),
            href: legacy[2].trim(),
            label: legacy[1].trim(),
            image: false,
            section,
          });
          continue;
        }
      }
      if (token.type === "link" || token.type === "image") {
        result.push({
          start,
          end: cursor,
          raw: token.raw,
          href: token.href,
          label: token.text,
          image: token.type === "image",
          section,
        });
        if (token.type === "link" && token.tokens)
          visit(token.tokens, start + 1);
      } else if (token.type !== "code" && token.type !== "codespan") {
        if (token.items) visit(token.items, start);
        else if (token.tokens) visit(token.tokens, start);
      }
    }
  }
  visit(tokens as Token[], 0);
  return result;
}
export function removeResourcePlacement(
  body: string,
  placement: ResourcePlacement,
) {
  let { start, end } = placement;
  const lineStart = body.lastIndexOf("\n", start - 1) + 1;
  const nextLine = body.indexOf("\n", end);
  const lineEnd = nextLine < 0 ? body.length : nextLine;
  if (
    /^\s*[-*]\s*$/.test(body.slice(lineStart, start)) &&
    !body.slice(end, lineEnd).trim()
  ) {
    start = lineStart;
    end = nextLine < 0 ? lineEnd : lineEnd + 1;
  }
  return body.slice(0, start) + body.slice(end);
}
export function replaceResourceReferences(
  body: string,
  before: string,
  after: string,
) {
  if (!repositoryAssetPath(before)) return body;
  const refs = resourcePlacements(body).filter(
    (p) => repositoryAssetPath(p.href) === repositoryAssetPath(before),
  );
  for (const p of refs.sort((a, b) => b.start - a.start)) {
    const hrefAt = p.raw.lastIndexOf(p.href);
    const replacement =
      hrefAt >= 0
        ? p.raw.slice(0, hrefAt) + after + p.raw.slice(hrefAt + p.href.length)
        : `${p.image ? "!" : ""}[${markdownLabel(p.label)}](${after})`;
    body = body.slice(0, p.start) + replacement + body.slice(p.end);
  }
  return body;
}
/** Find section boundaries through the Markdown lexer so fenced examples stay untouched. */
export function appendToResourceSection(
  body: string,
  heading: string,
  markdown: string,
) {
  let cursor = 0,
    start = -1,
    end = body.length;
  for (const token of marked.lexer(body)) {
    const at = body.indexOf(token.raw, cursor);
    cursor = at + token.raw.length;
    if (token.type !== "heading" || token.depth !== 2) continue;
    if (start >= 0) {
      end = at;
      break;
    }
    if (token.text === heading) start = cursor;
  }
  if (start < 0) return `${body.trimEnd()}\n\n## ${heading}\n\n${markdown}\n`;
  return `${body.slice(0, end).trimEnd()}\n\n${markdown}\n${end < body.length ? "\n" + body.slice(end) : ""}`;
}
export function attachResource(body: string, label: string, href: string) {
  return appendToResourceSection(
    body,
    "Resources",
    `- [${markdownLabel(label)}](${href})`,
  );
}
