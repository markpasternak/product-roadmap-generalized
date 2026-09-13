import { readdir, readFile, lstat } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const identity = /^ast_[a-z0-9_-]+$/;
const revisionPath = /^(rev_[a-z0-9_-]+)\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const mediaTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  txt: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  json: "text/plain; charset=utf-8",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export async function confinedFile(root, path) {
  const full = resolve(root, path);
  if (!full.startsWith(resolve(root) + "/"))
    throw new Error("Resource path leaves repository");
  let current = resolve(root);
  for (const part of relative(root, full).split("/")) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Symbolic resource paths are not supported");
  }
  return full;
}
export async function assetCatalog(root) {
  const directory = join(root, "content/assets");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const out = [];
  for (const entry of entries) {
    if (!identity.test(entry.name) || !entry.isDirectory())
      throw new Error(`Invalid resource directory: ${entry.name}`);
    const path = await confinedFile(
      root,
      `content/assets/${entry.name}/asset.json`,
    );
    const asset = JSON.parse(await readFile(path, "utf8"));
    if (
      asset.schemaVersion !== 1 ||
      asset.id !== entry.name ||
      !["Internal", "Public"].includes(asset.visibility) ||
      !asset.name ||
      !Array.isArray(asset.revisions) ||
      !asset.revisions.length
    )
      throw new Error(`Invalid resource manifest: ${entry.name}`);
    const ids = new Set();
    for (const revision of asset.revisions) {
      const f = revision.original;
      if (
        !f ||
        !revisionPath.test(f.path) ||
        mediaTypes[f.path.split(".").at(-1).toLowerCase()] !== f.mediaType ||
        f.path.split("/")[0] !== revision.id ||
        ids.has(revision.id) ||
        !/^[a-f0-9]{64}$/.test(f.sha256) ||
        !Number.isSafeInteger(f.bytes) ||
        f.bytes <= 0 ||
        f.bytes > 25 * 1048576
      )
        throw new Error(`Invalid resource revision: ${entry.name}`);
      ids.add(revision.id);
      const bytes = await readFile(
        await confinedFile(root, `content/assets/${asset.id}/${f.path}`),
      );
      if (
        bytes.length !== f.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== f.sha256
      )
        throw new Error(`Resource checksum mismatch: ${asset.name}`);
    }
    out.push(asset);
  }
  return out;
}
/** One resource policy for full builds, content jobs and the development model. */
export async function prepareResources(root, model, audience) {
  try { await confinedFile(root, 'content/assets'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const assets = await assetCatalog(root);
  const available = new Map(assets.flatMap(asset => asset.revisions.map(revision => [`assets/${asset.id}/${revision.original.path}`, { asset, revision }])));
  const refs = new Set([...JSON.stringify(model).matchAll(/assets\/(ast_[a-z0-9_-]+)\/(rev_[a-z0-9_-]+)\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)/g)].map(match => match[0]));
  const originals = [];
  for (const path of refs) {
    const entry = available.get(path);
    if (!entry) throw new Error(`Published content references a missing resource: ${path}`);
    if (audience === 'public' && entry.asset.visibility !== 'Public') throw new Error('Public content references an Internal resource');
    originals.push({ path, source: await confinedFile(root, `content/${path}`) });
  }
  const catalog = {
    documents: model.documents.map(doc => ({ title: doc.data.title ?? doc.id, path: doc.filePath })),
    assets: assets.filter(asset => audience !== 'public' || asset.visibility === 'Public').map(asset => ({
      id: asset.id, name: asset.name, visibility: asset.visibility,
      revisions: asset.revisions.filter(revision => refs.has(`assets/${asset.id}/${revision.original.path}`)).map(revision => ({ id: revision.id, original: revision.original })),
    })).filter(asset => asset.revisions.length),
  };
  return { catalog, originals };
}
export default function managedAssets(
  audience,
  base = "/",
  root = fileURLToPath(new URL("../../", import.meta.url)),
) {
  return {
    name: "managed-git-resources",
    hooks: {
      "astro:server:setup"({ server }) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = (req.url ?? "").split("?")[0];
          const prefix = base.replace(/\/$/, "");
          const assetPath = pathname.slice(prefix.length + 1);
          if (!assetPath.startsWith("assets/ast_")) return next();
          try {
            const assets = await assetCatalog(root);
            const a = assets.find((a) =>
              assetPath.startsWith(`assets/${a.id}/`),
            );
            const revision = a?.revisions.find(
              (r) => assetPath === `assets/${a.id}/${r.original.path}`,
            );
            if (
              !a ||
              !revision ||
              (audience === "public" && a.visibility !== "Public")
            ) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const bytes = await readFile(
              await confinedFile(root, `content/${assetPath}`),
            );
            res.setHeader("Content-Type", revision.original.mediaType);
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.end(bytes);
          } catch (error) {
            res.statusCode = 500;
            res.end("Resource unavailable");
          }
        });
      },
    },
  };
}
