import type { ItemVM } from "../filters";
import type { ProjectedItem } from "./project";
import {
  repositoryAssetPath,
  resourceHref,
  resourcePlacements,
  isImageResource,
} from "../resources";
export type ShareResourceChoice = {
  key: string;
  itemId: string;
  label: string;
  href: string;
  repoPath: string | null;
  image?: boolean;
};
export type SharedResource = {
  label: string;
  href: string;
  mediaType?: string;
  bytes?: number;
  sha256?: string;
  image?: boolean;
};
export function shareResourceChoices(items: ItemVM[]): ShareResourceChoice[] {
  const out: ShareResourceChoice[] = [];
  for (const item of items) {
    const links = [
      ...item.links.map((l) => ({ href: l.target, label: l.title || l.label, image: l.image || isImageResource(l.target) })),
      ...item.sections.flatMap((s) => resourcePlacements(s.markdown ?? "")),
    ];
    for (const link of links) {
      const repoPath = repositoryAssetPath(link.href);
      if (!repoPath && !/^https?:\/\//i.test(link.href)) continue;
      const key = `${item.id}:${repoPath ?? link.href}`;
      const existing = out.find(r => r.key === key);
      if (existing) { if (link.image) existing.image = true; continue; }
      out.push({
        key,
        itemId: item.id,
        label: link.label,
        href: link.href,
        repoPath,
        ...(link.image ? { image: true } : {}),
      });
    }
  }
  return out;
}
const dataURL = (bytes: Uint8Array, mime: string) => {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(raw)}`;
};
/** Resolve only explicitly selected resources, verify originals, then freeze their bytes. */
export async function prepareShareResources(
  items: ProjectedItem[],
  selected: ShareResourceChoice[],
  base = "/",
  preview = false,
) {
  const files: Record<string, Uint8Array> = {},
    resources = new Map<string, SharedResource[]>();
  let catalog: any = null,
    total = 0;
  for (const choice of selected) {
    if (!items.some((i) => i.id === choice.itemId)) continue;
    let resource: SharedResource = { label: choice.label, href: choice.href, ...(choice.image ? { image: true } : {}) };
    if (choice.repoPath) {
      if (!catalog) {
        const res = await fetch(`${base}resources.json`, { cache: "no-store" });
        if (!res.ok)
          throw new Error("Could not verify the selected files. Try again.");
        catalog = await res.json();
      }
      const a = catalog.assets?.find((a: any) =>
        choice.repoPath!.startsWith(`content/assets/${a.id}/`),
      );
      const revision = a?.revisions.find(
        (r: any) =>
          choice.repoPath === `content/assets/${a.id}/${r.original.path}`,
      );
      if (!revision)
        throw new Error(
          `${choice.label} is not published yet. Publish it before sharing.`,
        );
      const f = revision.original;
      const dst = choice.repoPath.slice("content/".length);
      let bytes = files[dst];
      if (!bytes) {
        const res = await fetch(resourceHref(choice.repoPath, base), {
          cache: "no-store",
        });
        if (!res.ok || res.headers.get("content-type")?.includes("text/html"))
          throw new Error(`Could not load ${choice.label}.`);
        bytes = new Uint8Array(await res.arrayBuffer());
        total += bytes.length;
        if (total > 100 * 1048576)
          throw new Error("Choose up to 100 MiB of files for one share.");
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
          ),
        )
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (bytes.length !== f.bytes || digest !== f.sha256)
          throw new Error(
            `${choice.label} did not match its published original. Try again.`,
          );
        files[dst] = bytes;
      }
      resource = {
        label: choice.label,
        href: preview ? dataURL(bytes, f.mediaType) : dst,
        mediaType: f.mediaType,
        bytes: f.bytes,
        sha256: f.sha256,
      };
    } else if (!/^https?:\/\//i.test(choice.href))
      throw new Error("Unsupported resource link");
    resources.set(choice.itemId, [
      ...(resources.get(choice.itemId) ?? []),
      resource,
    ]);
  }
  return {
    items: items.map((i) => ({
      ...i,
      ...(resources.has(i.id) ? { resources: resources.get(i.id) } : {}),
    })),
    files,
  };
}
