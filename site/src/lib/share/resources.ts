import type { ItemVM } from "../filters";
import type { ProjectedItem } from "./project";
import { isStoryHeading } from '../sectionHeadings';
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
  inline?: boolean;
  cover?: boolean;
};
export type SharedResource = {
  label: string;
  href: string;
  mediaType?: string;
  bytes?: number;
  sha256?: string;
  image?: boolean;
  inline?: boolean;
};
export function shareResourceChoices(items: ItemVM[]): ShareResourceChoice[] {
  const out: ShareResourceChoice[] = [];
  for (const item of items) {
    const links = [
      ...item.links.map((l) => ({ href: l.target, label: l.title || l.label, image: l.image || isImageResource(l.target) })),
      ...item.sections.flatMap((s) => resourcePlacements(s.markdown ?? "").map(p => ({ ...p, inline: p.image && isStoryHeading(s.heading) }))),
    ];
    for (const link of links) {
      const repoPath = repositoryAssetPath(link.href);
      if (!repoPath && !/^https?:\/\//i.test(link.href)) continue;
      const key = `${item.id}:${repoPath ?? link.href}`;
      const existing = out.find(r => r.key === key);
      const inline = 'inline' in link && link.inline === true;
      if (existing) { if (link.image) existing.image = true; if (inline) existing.inline = true; continue; }
      out.push({
        key,
        itemId: item.id,
        label: link.label,
        href: link.href,
        repoPath,
        ...(link.image ? { image: true } : {}),
        ...(inline ? { inline: true } : {}),
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
/** Inline images travel with the text. Other resources remain opt-in. */
export async function prepareShareResources(
  items: ProjectedItem[],
  selected: ShareResourceChoice[],
  base = "/",
  preview = false,
) {
  const files: Record<string, Uint8Array> = {},
    resources = new Map<string, SharedResource[]>(),
    covers = new Map<string, string>();
  let catalog: any = null,
    total = 0;
  const choices = new Map(selected.filter(choice => items.some(item => item.id === choice.itemId)).map(choice => [choice.key, choice]));
  for (const item of items) {
    if (item.cover) {
      const repoPath = repositoryAssetPath(item.cover);
      if (!repoPath) throw new Error(`The cover for ${item.title} must use a managed image resource.`);
      choices.set(`${item.id}:cover`, { key: `${item.id}:cover`, itemId: item.id, href: item.cover, label: `${item.title} cover`, repoPath, image: true, cover: true });
    }
    for (const section of item.sections ?? []) for (const block of section.blocks ?? []) {
      if (!('image' in block)) continue;
      const { href, label } = block.image;
      const repoPath = repositoryAssetPath(href);
      const key = `${item.id}:${repoPath ?? href}`;
      choices.set(key, { key, itemId: item.id, href, label, repoPath, image: true, inline: true });
    }
  }
  const resolved = new Map<string, SharedResource>();
  for (const choice of choices.values()) {
    if (!items.some((i) => i.id === choice.itemId)) continue;
    let resource: SharedResource = { label: choice.label, href: choice.href, ...(choice.image ? { image: true } : {}), ...(choice.inline ? { inline: true } : {}) };
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
      if (choice.cover && !f.mediaType.startsWith('image/'))
        throw new Error(`${choice.label} is not an image.`);
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
        ...resource,
        label: choice.label,
        href: preview ? dataURL(bytes, f.mediaType) : dst,
        mediaType: f.mediaType,
        bytes: f.bytes,
        sha256: f.sha256,
      };
    } else if (!/^https?:\/\//i.test(choice.href))
      throw new Error("Unsupported resource link");
    resolved.set(choice.key, resource);
    if (choice.cover) covers.set(choice.itemId, resource.href);
    else resources.set(choice.itemId, [
        ...(resources.get(choice.itemId) ?? []),
        resource,
      ]);
  }
  return {
    items: items.map((i) => ({
      ...i,
      ...(i.sections ? { sections: i.sections.map(section => ({
        ...section,
        ...(section.blocks ? { blocks: section.blocks.map(block => {
          if (!('image' in block)) return block;
          const resource = resolved.get(`${i.id}:${repositoryAssetPath(block.image.href) ?? block.image.href}`);
          if (!resource) throw new Error(`Could not include ${block.image.label}.`);
          return { image: { href: resource.href, label: block.image.label } };
        }) } : {}),
      })) } : {}),
      ...(resources.has(i.id) ? { resources: resources.get(i.id) } : {}),
      ...(covers.has(i.id) ? { cover: covers.get(i.id) } : {}),
    })),
    files,
  };
}
