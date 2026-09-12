import { ref } from "vue";
import { authedRequest, EDIT_API, getToken } from "./client";
import { repositoryAssetPath, type ResourceAsset, type ResourceUpload } from "../resources";
export const resourceTransferCount = ref(0);
export const resourcePreviewURLs = ref<Record<string, string>>({});
const imageRequests = new Map<string, Promise<void>>();
let resourceListCache: { at: number; assets: ResourceAsset[] } | undefined;
let resourceListRequest: Promise<ResourceAsset[]> | undefined;
const RESOURCE_LIST_TTL = 5 * 60_000;
const cloneResources = (assets: ResourceAsset[]): ResourceAsset[] =>
  typeof structuredClone === 'function' ? structuredClone(assets) : JSON.parse(JSON.stringify(assets));
/** Load authenticated originals when the static build has not caught up yet. */
export async function loadImagePreview(path: string): Promise<void> {
  if (!repositoryAssetPath(path) || resourcePreviewURLs.value[path]) return;
  if (imageRequests.has(path)) return imageRequests.get(path)!;
  const request = (async () => {
    const res = await authedRequest(`/api/assets/content?path=${encodeURIComponent(path)}`);
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/'))
      throw new Error('Image preview unavailable');
    const blob = await res.blob();
    if (!blob.size) throw new Error('Image preview unavailable');
    resourcePreviewURLs.value = { ...resourcePreviewURLs.value, [path]: URL.createObjectURL(blob) };
  })();
  imageRequests.set(path, request);
  try { await request; } finally { imageRequests.delete(path); }
}
export async function listResources(): Promise<ResourceAsset[]> {
  if (resourceListCache && Date.now() - resourceListCache.at < RESOURCE_LIST_TTL)
    return cloneResources(resourceListCache.assets);
  resourceListRequest ??= (async () => {
    const res = await authedRequest("/api/assets");
    if (!res.ok) throw new Error("Could not load the file library. Try again.");
    const assets = await res.json() as ResourceAsset[];
    resourceListCache = { at: Date.now(), assets };
    return assets;
  })();
  try { return cloneResources(await resourceListRequest); }
  finally { resourceListRequest = undefined; }
}
export function uploadResource(
  file: File,
  assetId: string | undefined,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<ResourceUpload> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const params = new URLSearchParams({ name: file.name });
    if (assetId) params.set("assetId", assetId);
    request.open("POST", `${EDIT_API}/api/uploads?${params}`);
    const token = getToken();
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    request.timeout = 120000;
    request.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((100 * e.loaded) / e.total));
    };
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal.removeEventListener("abort", abort);
    request.onerror = () =>
      reject(new Error("Upload interrupted. Your file is ready to retry."));
    request.ontimeout = () => reject(new Error("Upload timed out. Try again."));
    request.onabort = () =>
      reject(new DOMException("Upload canceled", "AbortError"));
    request.onload = () => {
      let result: any;
      try {
        result = JSON.parse(request.responseText);
      } catch {
        reject(new Error("Could not confirm the upload. Try again."));
        return;
      }
      if (request.status >= 200 && request.status < 300) {
        resourcePreviewURLs.value = {
          ...resourcePreviewURLs.value,
          [result.repoPath]: URL.createObjectURL(file),
        };
        resolve(result);
      } else reject(new Error(result.error || "Could not upload the file."));
    };
    if (signal.aborted) {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Upload canceled", "AbortError"));
    } else request.send(file);
  });
}
export async function recoverUpload(id: string): Promise<ResourceUpload> {
  const res = await authedRequest(`/api/uploads/${encodeURIComponent(id)}`);
  if (!res.ok)
    throw new Error("A draft upload expired. Upload that file again.");
  const upload = (await res.json()) as ResourceUpload;
  if (!resourcePreviewURLs.value[upload.repoPath]) {
    const bytes = await authedRequest(
      `/api/uploads/${encodeURIComponent(id)}/content`,
    );
    if (!bytes.ok) throw new Error("Could not load the draft preview.");
    resourcePreviewURLs.value = {
      ...resourcePreviewURLs.value,
      [upload.repoPath]: URL.createObjectURL(await bytes.blob()),
    };
  }
  return upload;
}
export async function cancelUpload(id: string) {
  const res = await authedRequest(`/api/uploads/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404)
    throw new Error("Could not remove that upload.");
}
