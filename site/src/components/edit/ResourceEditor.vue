<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, provide, nextTick } from "vue";
import ConfirmAction from "../ui/ConfirmAction.vue";
import ImagePicker from './ImagePicker.vue';
import ImageThumbnail from '../markdown/ImageThumbnail.vue';
import { parseSections } from '../../lib/edit/sections';
import { insertImageKey } from '../../lib/edit/imageAuthoring';
import { useEditStore } from "../../lib/edit/store";
import { authedRequest } from "../../lib/edit/client";
import {
  listResources,
  uploadResource,
  recoverUpload,
  cancelUpload,
  resourcePreviewURLs,
  resourceTransferCount,
  loadImagePreview,
} from "../../lib/edit/resourceClient";
import {
  attachResource,
  appendToResourceSection,
  markdownAssetPath,
  markdownLabel,
  readableBytes,
  repositoryAssetPath,
  resourceHref,
  resourcePlacements,
  removeResourcePlacement,
  replaceResourceReferences,
  type ResourceAsset,
  type ResourceUpload,
  isImageResource,
} from "../../lib/resources";
const props = defineProps<{ body: string; visibility: string; itemId?: string }>();
const emit = defineEmits<{ "update:body": [body: string] }>();
const store = useEditStore();
const locked = computed(() => !!store.snapshot().requestPayload);
const loading = ref(true);
const picker = ref<"upload" | "link" | "existing" | null>(null),
  expanded = ref<string | null>(null),
  librarySearch = ref(""),
  error = ref(""),
  notice = ref("");
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(notice, value => {
  clearTimeout(noticeTimer);
  if (value) noticeTimer = setTimeout(() => { notice.value = ''; }, 6000);
});
const library = ref<ResourceAsset[]>([]),
  uploads = ref<ResourceUpload[]>([]);
const fileInput = ref<HTMLInputElement>();
const addResourceButton = ref<HTMLButtonElement>();
const linkName = ref(""),
  linkURL = ref(""),
  selectedExisting = ref(""),
  replaceID = ref<string>();
const documents = ref<{ title: string; path: string }[]>([]);
const deleteAsset = ref<ResourceAsset | null>(null);
type Pending = {
  id: number;
  file: File;
  progress: number;
  error: string;
  controller: AbortController;
  assetId?: string;
  anchor?: { text: string; offset: number; length: number; emptySection?: string };
};
const pending = ref<Pending[]>([]);
let serial = 0,
  loadEpoch = 0;
const bookmark = ref<Pending["anchor"]>();
let markdownSelection: (() => { from: number; to: number } | undefined) | null =
  null;
provide("resource-markdown-selection", (read: typeof markdownSelection) => {
  markdownSelection = read;
});
const placements = computed(() => resourcePlacements(props.body));
const allAssets = computed(() => {
  const combined = [...library.value];
  for (const u of uploads.value) {
    const found = combined.find((a) => a.id === u.assetId);
    if (found) {
      if (!found.revisions.some((r) => r.id === u.revision.id))
        combined[combined.indexOf(found)] = {
          ...found,
          revisions: [...found.revisions, u.revision],
        };
    } else
      combined.push({
        schemaVersion: 1,
        id: u.assetId,
        name: u.name,
        visibility:
          store.snapshot().assets.attach.find((c) => c.uploadId === u.uploadId)
            ?.visibility ??
          (props.visibility === "Public" ? "Public" : "Internal"),
        revisions: [u.revision],
      });
  }
  return combined
    .map((a) => ({
      ...a,
      ...store.snapshot().assets.update.find((c) => c.id === a.id),
      placements: placements.value.filter((p) =>
        repositoryAssetPath(p.href)?.startsWith(`content/assets/${a.id}/`),
      ),
    }));
});
const attached = computed(() => allAssets.value.filter(a => a.placements.length));
const rows = computed(() => allAssets.value.filter(a => a.placements.length || a.id === expanded.value || a.remove));
const existingChoices = computed(() => [
  ...allAssets.value.filter(a => !a.remove).map(a => ({ id: a.id, name: a.name, href: imageHref(a), image: shownRevision(a).original.mediaType.startsWith('image/'), kind: 'File', added: a.placements.some(p => ['Resources', 'Links'].includes(p.section)) })),
  ...documents.value.map(d => ({ id: d.path, name: d.title, href: markdownAssetPath(d.path), image: false, kind: 'Document', added: external.value.some(p => resourceHref(p.href) === resourceHref(markdownAssetPath(d.path))) })),
].filter(choice => choice.name.toLowerCase().includes(librarySearch.value.toLowerCase())));
function toggleAdd() {
  picker.value = picker.value ? null : 'upload';
  selectedExisting.value = '';
  librarySearch.value = '';
}
async function closeAdd() {
  const restoreFocus = document.activeElement?.closest('.resource-picker');
  picker.value = null;
  await nextTick();
  if (restoreFocus) addResourceButton.value?.focus();
}
function toggleResource(id: string) { expanded.value = expanded.value === id ? null : id; }
async function removePlacement(placement: typeof placements.value[number], event?: Event) {
  const row = (event?.currentTarget as HTMLElement | null)?.closest('.resource-row');
  const shelf = row?.closest('.resource-shelf');
  emit('update:body', removeResourcePlacement(props.body, placement));
  notice.value = repositoryAssetPath(placement.href) ? 'Removed from this item. The original file is still in your library.' : 'Link removed from this item.';
  await nextTick();
  const target = row?.isConnected ? row : shelf;
  target?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus();
}
function shownRevision(asset: ResourceAsset & { placements?: typeof placements.value }) {
  const used = (asset.placements ?? []).map(p => repositoryAssetPath(p.href));
  return asset.revisions.find(r => used.includes(`content/assets/${asset.id}/${r.original.path}`)) ?? asset.revisions.at(-1)!;
}
function imageHref(asset: typeof allAssets.value[number]) {
  return markdownAssetPath(`content/assets/${asset.id}/${shownRevision(asset).original.path}`);
}
const imageChoices = computed(() => [...allAssets.value
  .filter(a => !a.remove && shownRevision(a).original.mediaType.startsWith('image/') && (props.visibility !== 'Public' || a.visibility === 'Public'))
  .filter(a => resourcePreviewURLs.value[repositoryAssetPath(imageHref(a))!] !== '')
  .map(a => ({ href: imageHref(a), name: a.name, attached: !!a.placements.length })),
  ...placements.value.filter(p => /^https?:\/\//i.test(p.href) && (p.image || isImageResource(p.href)))
    .map(p => ({ href: p.href, name: p.label || 'Image', attached: true }))]
  .filter((image, index, all) => all.findIndex(i => i.href === image.href) === index)
  .sort((a, b) => Number(b.attached) - Number(a.attached) || a.name.localeCompare(b.name)));
const imagePickerOpen = ref(false);
provide(insertImageKey, (target) => {
  if (locked.value) return;
  rememberSelection(target);
  imagePickerOpen.value = true;
});
function insertImage(markdown: string) {
  if (locked.value) { imagePickerOpen.value = false; return; }
  const next = placeInline(props.body, markdown, bookmark.value);
  if (next !== null) {
    emit('update:body', next);
    notice.value = 'Image inserted.';
  } else error.value = 'Choose a position in the write-up, then use its image toolbar again.';
  bookmark.value = undefined;
  imagePickerOpen.value = false;
}
function usedElsewhere(asset: ResourceAsset) {
  return (asset.usages ?? []).filter(path => {
    const id = path.split('/').at(-1)?.match(/^([a-z]+-\d+)(?:-|\.md$)/i)?.[1];
    return !props.itemId || id?.toLowerCase() !== props.itemId.toLowerCase();
  });
}
function fileStatus(asset: typeof allAssets.value[number]) {
  if (asset.remove) return 'Deletion in draft';
  if (!asset.sha) return 'Ready in draft';
  const changes = dirtyAssets();
  return changes.update.some(c => c.id === asset.id) || changes.attach.some(c => c.resource?.assetId === asset.id)
    ? 'Changes in draft' : 'Published';
}
const fileConflicts = computed(() =>
  library.value.filter((asset) => {
    const changes = store.snapshot().assets;
    return (
      changes.update.some(
        (c) => c.id === asset.id && c.baseManifestSha !== asset.sha,
      ) ||
      changes.attach.some(
        (c) =>
          c.resource?.assetId === asset.id && c.baseManifestSha !== asset.sha,
      )
    );
  }),
);
function keepFileChanges(asset: ResourceAsset) {
  if (!asset.sha) return;
  const changes = dirtyAssets();
  for (const change of changes.update)
    if (change.id === asset.id) change.baseManifestSha = asset.sha;
  for (const claim of changes.attach)
    if (claim.resource?.assetId === asset.id) claim.baseManifestSha = asset.sha;
  store.setAssets(changes);
  notice.value = "File changes reviewed. Publish again when ready.";
}
const external = computed(() =>
  placements.value.filter(
    (p) =>
      !repositoryAssetPath(p.href) &&
      ["Resources", "Links"].includes(p.section),
  ),
);
watch(
  pending,
  (jobs) => {
    resourceTransferCount.value = jobs.length;
  },
  { deep: true, flush: "sync" },
);
const dirtyAssets = () => store.snapshot().assets;
function rememberSelection(
  target: EventTarget | null = document.activeElement,
) {
  if (!(target instanceof HTMLTextAreaElement)) {
    const selection = markdownSelection?.();
    if (!selection) { bookmark.value = undefined; return; }
    const left = Math.max(0, selection.from - 80),
      right = Math.min(props.body.length, selection.to + 80);
    bookmark.value = {
      text: props.body.slice(left, right),
      offset: selection.from - left,
      length: selection.to - selection.from,
    };
    return;
  }
  const heading = target.dataset.resourceHeading;
  const sections = heading ? parseSections(props.body).sections.filter(s => s.heading.toLowerCase() === heading.toLowerCase()) : [];
  if (heading && !target.value.trim() && sections.length <= 1 && !sections[0]?.body.trim()) {
    bookmark.value = { text: '', offset: 0, length: 0, emptySection: sections[0]?.heading ?? heading };
    return;
  }
  const section = sections.length === 1 ? sections[0] : undefined;
  const prefix = section ? `## ${section.heading}\n` : '';
  const needle = prefix + target.value;
  const found = props.body.indexOf(needle);
  const start = found + prefix.length;
  if (found < 0 || found !== props.body.lastIndexOf(needle)) {
    bookmark.value = undefined;
    return;
  }
  const a = start + target.selectionStart,
    b = start + target.selectionEnd;
  const left = Math.max(0, a - 80),
    right = Math.min(props.body.length, b + 80);
  bookmark.value = {
    text: props.body.slice(left, right),
    offset: a - left,
    length: b - a,
  };
}
function placeInline(
  body: string,
  markdown: string,
  anchor?: Pending["anchor"],
) {
  if (anchor?.emptySection) {
    const sections = parseSections(body).sections.filter(s => s.heading.toLowerCase() === anchor.emptySection!.toLowerCase());
    if (sections.length > 1 || sections[0]?.body.trim()) return null;
    return appendToResourceSection(body, anchor.emptySection, markdown);
  }
  if (anchor) {
    const at = body.indexOf(anchor.text);
    if (at >= 0 && at === body.lastIndexOf(anchor.text))
      return (
        body.slice(0, at + anchor.offset) +
        markdown +
        body.slice(at + anchor.offset + anchor.length)
      );
    return null;
  }
  return null;
}
async function load() {
  const epoch = ++loadEpoch;
  loading.value = true;
  const previews = { ...resourcePreviewURLs.value };
  for (const claim of dirtyAssets().attach)
    if (claim.resource && !(claim.resource.repoPath in previews))
      previews[claim.resource.repoPath] = "";
  resourcePreviewURLs.value = previews;
  try {
    const assets = await listResources();
    if (epoch !== loadEpoch) return;
    library.value = assets;
    if (!locked.value) {
      const changes = dirtyAssets();
      const remaining = changes.attach.filter(
        (claim) =>
          !claim.resource ||
          !assets.some(
            (asset) =>
              asset.id === claim.resource!.assetId &&
              asset.revisions.some(
                (revision) =>
                  revision.id === claim.resource!.revision.id &&
                  revision.original.sha256 ===
                    claim.resource!.revision.original.sha256,
              ),
          ),
      );
      if (remaining.length !== changes.attach.length)
        store.setAssets({ ...changes, attach: remaining });
    }
    error.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  }
  if (epoch !== loadEpoch) return;
  uploads.value = uploads.value.filter((u) =>
    dirtyAssets().attach.some((c) => c.uploadId === u.uploadId),
  );
  for (const claim of dirtyAssets().attach) {
    if (uploads.value.some((u) => u.uploadId === claim.uploadId)) continue;
    try {
      const upload = await recoverUpload(claim.uploadId);
      if (epoch !== loadEpoch) return;
      uploads.value.push(upload);
    } catch (e) {
      if (epoch !== loadEpoch) return;
      if (claim.resource) uploads.value.push(claim.resource);
      error.value = claim.resource
        ? `${claim.resource.name} is unavailable. Replace it with a new upload, or remove its placements and delete it from the file library.`
        : (e as Error).message;
    }
  }
  loading.value = false;
  // Inline previews also need authenticated originals after reopening an editor.
  await Promise.allSettled(placements.value.filter(p => p.image).map(p => {
    const path = repositoryAssetPath(p.href);
    return path ? loadImagePreview(path) : Promise.resolve();
  }));
}
async function runUpload(job: Pending) {
  job.error = "";
  job.progress = 0;
  job.controller = new AbortController();
  try {
    const u = await uploadResource(
      job.file,
      job.assetId,
      (p) => (job.progress = p),
      job.controller.signal,
    );
    if (
      job.controller.signal.aborted ||
      !pending.value.some((p) => p.id === job.id)
    )
      return;
    if (!uploads.value.some((old) => old.uploadId === u.uploadId))
      uploads.value.push(u);
    const changes = dirtyAssets();
    const original = library.value.find((a) => a.id === u.assetId);
    if (!changes.attach.some((c) => c.uploadId === u.uploadId))
      changes.attach.push({
        uploadId: u.uploadId,
        resource: u,
        baseManifestSha: original?.sha,
        visibility:
          props.visibility === "Public"
            ? "Public"
            : (original?.visibility ?? "Internal"),
      });
    if (job.assetId)
      changes.attach = changes.attach.filter(
        (c) =>
          c.uploadId === u.uploadId ||
          !c.resource ||
          c.resource.assetId !== job.assetId ||
          Date.parse(c.resource.expiresAt) > Date.now(),
      );
    store.setAssets(changes);
    const href = markdownAssetPath(u.repoPath);
    let body = props.body;
    if (job.assetId) {
      for (const p of placements.value.filter((p) =>
        repositoryAssetPath(p.href)?.startsWith(
          `content/assets/${job.assetId}/`,
        ),
      ))
        body = replaceResourceReferences(body, p.href, href);
      notice.value =
        "New revision selected for this item. Other items keep their existing files.";
    } else if (job.anchor) {
      const inline = placeInline(
        body,
        `${u.revision.original.mediaType.startsWith("image/") ? "!" : ""}[${markdownLabel(u.name)}](${href})`,
        job.anchor,
      );
      body = inline ?? body;
      if (!inline || u.revision.original.mediaType.startsWith("image/")) body = attachResource(body, u.name, href);
      notice.value = inline
        ? "File inserted. Edit its text alternative in Markdown."
        : "The insertion point changed. Your file was added to Resources.";
    } else body = attachResource(body, u.name, href);
    emit("update:body", body);
    pending.value = pending.value.filter((p) => p.id !== job.id);
    void closeAdd();
    return u;
  } catch (e) {
    if ((e as Error).name === "AbortError")
      pending.value = pending.value.filter((p) => p.id !== job.id);
    else job.error = (e as Error).message;
  }
}
async function uploadPickerImage(file: File, signal: AbortSignal, onProgress: (progress: number) => void) {
  if (locked.value) throw new Error('Finish the pending publication before adding files.');
  if (!file.type.startsWith('image/') || !file.size || file.size > 25 * 1048576) throw new Error('Choose an image up to 25 MiB.');
  const job: Pending = { id: ++serial, file, progress: 0, error: '', controller: new AbortController() };
  pending.value.push(job);
  const active = pending.value.at(-1)!;
  const stopProgress = watch(() => active.progress, onProgress);
  const cancel = () => { active.controller.abort(); pending.value = pending.value.filter(p => p.id !== active.id); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Upload canceled.');
    const uploaded = await runUpload(active);
    if (!uploaded) throw new Error(active.error || 'Upload canceled.');
    return { href: markdownAssetPath(uploaded.repoPath), name: uploaded.name, attached: true };
  } finally {
    signal.removeEventListener('abort', cancel);
    stopProgress();
    pending.value = pending.value.filter(p => p.id !== active.id);
  }
}
async function chooseUpload(assetId?: string) {
  replaceID.value = assetId;
  await nextTick();
  fileInput.value?.click();
}
function queue(files: File[], inline = false) {
  if (locked.value) {
    error.value = "Finish the pending publication before adding files.";
    return;
  }
  for (const file of files) {
    if (file.size > 25 * 1048576 || !file.size) {
      error.value = "Choose non-empty files up to 25 MiB.";
      continue;
    }
    const job: Pending = {
      id: ++serial,
      file,
      progress: 0,
      error: "",
      controller: new AbortController(),
      assetId: inline ? undefined : replaceID.value,
      anchor: inline ? bookmark.value : undefined,
    };
    pending.value.push(job);
    void runUpload(pending.value.at(-1)!);
  }
  replaceID.value = undefined;
}
function paste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  rememberSelection(event.target);
  queue(files, true);
}
function drop(event: DragEvent) {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  event.stopPropagation();
  rememberSelection(event.target);
  queue(
    Array.from(event.dataTransfer.files),
    event.target instanceof HTMLTextAreaElement ||
      !!(event.target as Element)?.closest("[contenteditable]"),
  );
}
function addLink() {
  try {
    const url = new URL(linkURL.value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    emit(
      "update:body",
      attachResource(
        props.body,
        linkName.value.trim() || url.hostname,
        url.href,
      ),
    );
    void closeAdd();
    linkName.value = "";
    linkURL.value = "";
    error.value = "";
  } catch {
    error.value = "Enter a complete http or https link.";
  }
}
function editExternal(start: number, field: "label" | "href", value: string) {
  const p = placements.value.find((p) => p.start === start);
  if (!p) return;
  const href = field === "href" ? value : p.href;
  if (field === "href" && !/^(https?:\/\/|\.\.\/)/.test(href)) {
    error.value = "Use a complete http or https link.";
    return;
  }
  const label = field === "label" ? value : p.label;
  emit(
    "update:body",
    props.body.slice(0, p.start) +
      `${p.image ? '!' : ''}[${markdownLabel(label)}](${href})` +
      props.body.slice(p.end),
  );
}
function addExisting() {
  if (!existingChoices.value.some(choice => choice.id === selectedExisting.value && !choice.added)) return;
  const asset = allAssets.value.find((a) => a.id === selectedExisting.value && !a.remove);
  if (asset?.placements.some(p => ["Resources", "Links"].includes(p.section))) return;
  if (asset) {
    const rev = shownRevision(asset);
    emit(
      "update:body",
      attachResource(
        props.body,
        asset.name,
        markdownAssetPath(`content/assets/${asset.id}/${rev.original.path}`),
      ),
    );
  } else {
    const doc = documents.value.find((d) => d.path === selectedExisting.value);
    if (doc)
      emit(
        "update:body",
        attachResource(props.body, doc.title, markdownAssetPath(doc.path)),
      );
  }
  void closeAdd();
}
function editAlt(start: number, label: string) {
  const p = placements.value.find((p) => p.start === start);
  if (p)
    emit(
      "update:body",
      props.body.slice(0, p.start) +
        `![${markdownLabel(label)}](${p.href})` +
        props.body.slice(p.end),
    );
}
function rename(asset: ResourceAsset, name: string) {
  if (!name.trim()) return;
  const changes = dirtyAssets();
  if (asset.sha) {
    const existing = changes.update.find((c) => c.id === asset.id);
    if (existing) existing.name = name.trim();
    else
      changes.update.push({
        id: asset.id,
        baseManifestSha: asset.sha,
        name: name.trim(),
      });
    store.setAssets(changes);
  } else {
    for (const u of uploads.value.filter((u) => u.assetId === asset.id)) {
      const claim = changes.attach.find((c) => c.uploadId === u.uploadId);
      if (claim) claim.name = name.trim();
      u.name = name.trim();
    }
    store.setAssets(changes);
  }
  let body = props.body;
  for (const p of placements.value
    .filter(
      (p) =>
        !p.image &&
        repositoryAssetPath(p.href)?.startsWith(`content/assets/${asset.id}/`),
    )
    .reverse())
    body =
      body.slice(0, p.start) +
      `${p.image ? "!" : ""}[${markdownLabel(name)}](${p.href})` +
      body.slice(p.end);
  emit("update:body", body);
  const row = library.value.find((a) => a.id === asset.id);
  if (row) row.name = name.trim();
}
function makePublic(asset: ResourceAsset) {
  const changes = dirtyAssets();
  if (!asset.sha) {
    for (const upload of uploads.value.filter((u) => u.assetId === asset.id)) {
      const claim = changes.attach.find((c) => c.uploadId === upload.uploadId);
      if (claim) claim.visibility = "Public";
    }
    store.setAssets(changes);
    return;
  }
  const update = changes.update.find((c) => c.id === asset.id);
  if (update) update.visibility = "Public";
  else
    changes.update.push({
      id: asset.id,
      baseManifestSha: asset.sha,
      visibility: "Public",
    });
  store.setAssets(changes);
  asset.visibility = "Public";
  notice.value =
    "File will be available on the public roadmap after publishing.";
}
async function removeFile() {
  const asset = deleteAsset.value;
  if (!asset) return;
  deleteAsset.value = null;
  if (asset.sha) {
    const changes = dirtyAssets();
    changes.update = changes.update.filter((c) => c.id !== asset.id);
    changes.update.push({
      id: asset.id,
      baseManifestSha: asset.sha,
      remove: true,
    });
    store.setAssets(changes);
    notice.value =
      "File marked for deletion. Publish to remove it from your library.";
  } else {
    for (const u of uploads.value.filter((u) => u.assetId === asset.id)) {
      try {
        await cancelUpload(u.uploadId);
      } catch (e) {
        error.value = (e as Error).message;
        return;
      }
      const changes = dirtyAssets();
      changes.attach = changes.attach.filter((c) => c.uploadId !== u.uploadId);
      store.setAssets(changes);
    }
    uploads.value = uploads.value.filter((u) => u.assetId !== asset.id);
    notice.value = "Unpublished upload removed.";
  }
}
async function download(asset: ResourceAsset & { placements?: typeof placements.value }) {
  const file = shownRevision(asset).original;
  try {
  const p = `content/assets/${asset.id}/${file.path}`;
  let url = resourcePreviewURLs.value[p];
  let temporary = false;
  if (!url) {
    const res = await authedRequest(
      `/api/assets/content?path=${encodeURIComponent(p)}`,
    );
    if (!res.ok) {
      error.value = "Could not download this file.";
      return;
    }
    url = URL.createObjectURL(await res.blob());
    temporary = true;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = file.path.split("/").pop()!;
  a.click();
  if (temporary) setTimeout(() => URL.revokeObjectURL(url!), 60000);
  } catch { error.value = "Could not download this file. Please try again."; }
}
onMounted(async () => {
  await load();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}resources.json`);
    if (res.ok) documents.value = (await res.json()).documents ?? [];
  } catch {
    /* linked documents can still be pasted */
  }
});
watch(locked, (value, old) => {
  if (old && !value) void load();
});
watch(
  () => store.snapshot().assets.attach.length,
  (n, old) => {
    if (n < old) void load();
  },
);
onUnmounted(() => {
  clearTimeout(noticeTimer);
  loadEpoch++;
  pending.value.forEach((p) => p.controller.abort());
  resourceTransferCount.value = 0;
});
</script>
<template>
  <div
    class="resource-authoring"
    @paste.capture="paste"
    @drop.capture="drop"
    @dragover="
      (event) => {
        if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
      }
    "
  >
    <p v-if="locked" role="status" class="resource-muted">
      Files are included in the pending publication. Finish it before changing
      files.
    </p>
    <section
      v-if="fileConflicts.length"
      class="resource-picker"
      aria-label="Review changed files"
    >
      <h3>These files changed while you were editing</h3>
      <p>
        Review the latest original before applying your pending file changes.
      </p>
      <article
        v-for="asset in fileConflicts"
        :key="asset.id"
        class="resource-row"
      >
        <p>Latest: {{ asset.name }} · {{ asset.visibility }}</p>
        <p>
          Your change:
          {{
            store.snapshot().assets.update.find((c) => c.id === asset.id)
              ?.remove
              ? "Delete file"
              : store.snapshot().assets.update.find((c) => c.id === asset.id)
                  ?.name || "File revision or visibility"
          }}
        </p>
        <div class="resource-actions">
          <button type="button" @click="download(asset)">Download latest</button
          ><button type="button" @click="keepFileChanges(asset)">
            Keep my file changes
          </button>
        </div>
      </article>
    </section>
    <slot :managed-resource-hrefs="[...attached.flatMap(a => a.placements.map(p => p.href)), ...external.map(p => p.href)]" />
    <ImagePicker v-if="imagePickerOpen" :images="imageChoices" :upload-image="uploadPickerImage" @insert="insertImage" @cancel="imagePickerOpen = false" />
    <fieldset :disabled="locked" class="resource-controls">
      <section class="resource-shelf" aria-label="Resources">
        <div class="resource-shelf-heading">
          <div><h3>Resources <span v-if="attached.length + external.length" class="resource-count">{{ attached.length + external.length }}</span></h3>
          <p v-if="attached.length + external.length" class="resource-muted">Files and links supporting this item.</p></div>
          <button ref="addResourceButton" type="button" :aria-expanded="!!picker" @click="toggleAdd">Add resource</button>
        </div>
      <section v-if="picker" class="resource-picker" aria-label="Add resource">
        <div class="resource-picker-tabs">
          <button
            type="button"
            :aria-pressed="picker === 'upload'"
            @click="picker = 'upload'"
          >
            Upload files</button
          ><button
            type="button"
            :aria-pressed="picker === 'link'"
            @click="picker = 'link'"
          >
            Paste a link</button
          ><button
            type="button"
            :aria-pressed="picker === 'existing'"
            @click="picker = 'existing'"
          >
            Choose existing</button
          ><button type="button" @click="closeAdd">Close</button>
        </div>
        <div v-if="picker === 'upload'" class="resource-upload-area">
          <p>
            Drop files here, paste an image into the write-up, or choose files.
          </p>
          <p class="resource-muted">
            Up to 25 MiB each · Files stay in your draft until you publish.
          </p>
          <p v-if="visibility === 'Public'" class="resource-muted">
            This item is Public. New files will be public when you publish.
          </p>
          <button type="button" @click="chooseUpload()">
            Choose files
          </button>
        </div>
        <form v-else-if="picker === 'link'" @submit.prevent="addLink">
          <label
            >Name<input
              v-model="linkName"
              placeholder="Interaction design" /></label
          ><label
            >Link<input
              v-model="linkURL"
              type="url"
              required
              placeholder="https://…" /></label
          ><button type="submit">Add link</button>
        </form>
        <form v-else @submit.prevent="addExisting">
          <label>Find a file or document<input v-model="librarySearch" type="search" placeholder="Search resources…" /></label>
          <div class="existing-resource-list" aria-label="Existing resources">
            <button v-for="choice in existingChoices" :key="choice.id" type="button" class="existing-resource-choice" :aria-pressed="selectedExisting === choice.id" :disabled="choice.added" @click="selectedExisting = choice.id">
              <ImageThumbnail v-if="choice.image" :href="choice.href" authenticated />
              <span v-else class="resource-kind">{{ choice.kind === 'File' ? 'FILE' : 'DOC' }}</span>
              <span><strong>{{ choice.name }}</strong><small>{{ choice.added ? 'Already attached' : choice.kind }}</small></span>
            </button>
            <p v-if="!existingChoices.length" class="resource-muted">{{ loading ? 'Loading resources…' : 'No matching resources. Try another name or upload a file.' }}</p>
          </div>
          <button type="submit" :disabled="!selectedExisting || !existingChoices.some(c => c.id === selectedExisting && !c.added)">Attach resource</button>
        </form>
      </section>
      <input
        ref="fileInput"
        type="file"
        :multiple="!replaceID"
        @cancel="replaceID = undefined"
        hidden
        @change="
          (event) => {
            queue(Array.from((event.target as HTMLInputElement).files ?? []));
            (event.target as HTMLInputElement).value = '';
          }
        "
      />
      <div
        v-for="job in pending"
        :key="job.id"
        class="resource-upload-progress"
      >
        <span
          >{{ job.file.name }} ·
          {{
            job.error ||
            (job.progress === 100 ? "Processing…" : `${job.progress}% uploaded`)
          }}</span
        ><progress
          v-if="!job.error"
          :value="job.progress"
          max="100"
          :aria-label="`Uploading ${job.file.name}`"
        /><button v-if="job.error" type="button" @click="runUpload(job)">
          Retry</button
        ><button
          type="button"
          @click="
            job.controller.abort();
            pending = pending.filter((p) => p.id !== job.id);
          "
        >
          Cancel
        </button>
      </div>
      <p v-if="error" role="alert" class="resource-error">
        {{ error }} <button type="button" @click="load">Try again</button>
      </p>
      <p v-if="notice" role="status" class="resource-muted">{{ notice }}</p>
        <p v-if="loading" role="status" class="resource-muted">Loading resources…</p>
        <p v-else-if="!rows.length && !external.length && !picker" class="resource-empty">Add files or links to this item.</p>
        <article v-for="asset in rows" :key="asset.id" class="resource-row" :class="{ 'resource-row-expanded': expanded === asset.id }">
          <div class="resource-row-main">
            <ImageThumbnail v-if="shownRevision(asset).original.mediaType.startsWith('image/')" :href="imageHref(asset)" authenticated />
            <span v-else class="resource-kind">{{ shownRevision(asset).original.path.split('.').pop()?.toUpperCase() }}</span>
            <div class="resource-identity"><strong>{{ asset.name }}</strong>
              <p class="resource-muted">{{ readableBytes(shownRevision(asset).original.bytes) }} · {{ fileStatus(asset) }}
                <span v-if="!asset.placements.length"> · Not used here</span>
              </p>
            </div>
            <button type="button" class="resource-quiet" :aria-label="`Download ${asset.name}`" @click="download(asset)">Download</button>
            <button v-if="!asset.remove" type="button" :aria-label="`${expanded === asset.id ? 'Close' : 'Edit'} ${asset.name}`" :aria-expanded="expanded === asset.id" @click="toggleResource(asset.id)">{{ expanded === asset.id ? 'Done' : 'Edit' }}</button>
            <button v-else type="button" @click="store.setAssets({ ...dirtyAssets(), update: dirtyAssets().update.filter(c => c.id !== asset.id) })">Undo deletion</button>
          </div>
          <p v-if="visibility === 'Public' && asset.visibility !== 'Public'" class="resource-error">
            This file is internal. <button type="button" @click="makePublic(asset)">Make file public</button>
          </p>
          <div v-if="expanded === asset.id && !asset.remove" class="resource-inspector">
            <div class="resource-details">
              <label>Display name<input :value="asset.name" @change="rename(asset, ($event.target as HTMLInputElement).value)" /></label>
              <label v-for="placement in asset.placements.filter(p => p.image)" :key="placement.start">
                Image description · {{ placement.section || 'Write-up' }}
                <input :value="placement.label" placeholder="Describe what the image shows" @change="editAlt(placement.start, ($event.target as HTMLInputElement).value)" />
              </label>
              <p v-if="asset.placements.some(p => p.image)" class="resource-muted">Describe the image for people using a screen reader.</p>
            </div>
            <div class="resource-placements">
              <h4>In this item</h4>
              <ul v-if="asset.placements.length">
                <li v-for="placement in asset.placements" :key="placement.start">
                  <span>{{ placement.section || 'Write-up' }}<small>{{ placement.image ? 'Inline image' : ['Resources', 'Links'].includes(placement.section) ? 'Attachment' : 'Text link' }}</small></span>
                  <button type="button" class="resource-quiet" :aria-label="`Remove from ${placement.section || 'write-up'}`" @click="removePlacement(placement, $event)">Remove</button>
                </li>
              </ul>
              <p v-else class="resource-muted">This file is available in your library.</p>
              <div v-if="!asset.placements.some(p => ['Resources', 'Links'].includes(p.section))" class="resource-actions">
                <button type="button" class="resource-quiet" @click="emit('update:body', attachResource(body, asset.name, imageHref(asset)))">Attach to item</button>
              </div>
            </div>
            <footer class="resource-file-actions">
              <div><button type="button" class="resource-quiet" @click="chooseUpload(asset.id)">Replace file…</button></div>
              <div class="resource-delete"><button type="button" class="resource-quiet resource-danger" :disabled="!!asset.placements.length || !!usedElsewhere(asset).length" @click="deleteAsset = asset">Delete from library…</button>
                <small v-if="usedElsewhere(asset).length">Still used elsewhere on the roadmap.</small>
                <small v-else-if="asset.placements.length">Remove its uses in this item first.</small>
              </div>
            </footer>
          </div>
        </article>
          <article v-for="link in external" :key="link.start" class="resource-row">
            <div class="resource-row-main">
              <ImageThumbnail v-if="link.image || isImageResource(link.href)" :href="link.href" />
              <span v-else class="resource-kind">LINK</span>
              <div class="resource-identity"><strong>{{ link.label || 'Untitled link' }}</strong><p class="resource-muted resource-link-url">{{ link.href }}</p></div>
              <a :href="resourceHref(link.href)" target="_blank" rel="noopener">Open</a>
              <button type="button" :aria-expanded="expanded === `link-${link.start}`" @click="toggleResource(`link-${link.start}`)">{{ expanded === `link-${link.start}` ? 'Done' : 'Edit' }}</button>
            </div>
            <div v-if="expanded === `link-${link.start}`" class="resource-link-editor">
              <label>Display name<input :value="link.label" @change="editExternal(link.start, 'label', ($event.target as HTMLInputElement).value)" /></label>
              <label>Link<input :value="link.href" @change="editExternal(link.start, 'href', ($event.target as HTMLInputElement).value)" /></label>
              <button type="button" class="resource-quiet resource-danger" @click="removePlacement(link, $event); expanded = null">Remove</button>
            </div>
          </article>
      </section>
    </fieldset>
    <ConfirmAction
      v-if="deleteAsset"
      title="Delete this file?"
      message="This deletes the unused file from the library when you publish. Existing shared copies and version history are kept."
      confirm-label="Delete on publish"
      @cancel="deleteAsset = null"
      @confirm="removeFile"
    />
  </div>
</template>
<style scoped>
.resource-controls {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.resource-controls:disabled {
  opacity: 0.65;
}
.resource-authoring {
  min-width: 0;
}
.resource-shelf-heading,
.resource-row-main,
.resource-picker-tabs,
.resource-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.resource-shelf-heading {
  justify-content: space-between;
  margin-bottom: 0.8rem;
}
.resource-controls button,
.resource-controls input,
.resource-controls select {
  font: inherit;
}
.resource-controls button, .resource-picker button {
  min-height: 38px;
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 7px;
  background: var(--color-card);
  padding: 0.4rem 0.7rem;
  font-size: 0.8rem;
  color: var(--color-text-primary-default);
  cursor: pointer;
}
.resource-controls button:disabled, .resource-picker button:disabled {
  opacity: 0.45;
  cursor: default;
}
.resource-controls button:hover:not(:disabled), .resource-picker button:hover:not(:disabled) {
  background: var(--color-surface-primary-hover);
}
.resource-picker,
.resource-shelf {
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 12px;
  padding: 1rem;
  background: var(--color-card);
  margin: 1rem 0;
}
.resource-picker-tabs button[aria-pressed="true"] {
  color: var(--color-accent-brand-default);
  border-color: currentColor;
}
.resource-upload-area {
  padding: 1rem 0;
}
.resource-upload-area > button {
  margin-top: 0.7rem;
}
.resource-muted {
  font-size: 0.78rem;
  color: var(--color-text-subtle-default);
  overflow-wrap: anywhere;
  margin: 0.2rem 0;
}
.resource-error {
  font-size: 0.85rem;
  color: var(--color-feedback-error-text-independent-default);
  padding: 0.6rem 0;
}
.resource-picker form {
  display: grid;
  gap: 0.8rem;
  padding-top: 1rem;
}
.resource-controls label {
  display: grid;
  gap: 0.3rem;
  font-size: 0.8rem;
  max-width: 480px;
}
.resource-controls input,
.resource-controls select {
  width: 100%;
  border: 1px solid var(--color-border-subtle-default);
  background: var(--color-card);
  border-radius: 6px;
  padding: 0.55rem;
  color: var(--color-text-primary-default);
}
.resource-upload-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem;
  border-bottom: 1px solid var(--color-border-subtle-default);
  font-size: 0.8rem;
}
.resource-upload-progress progress {
  width: 100px;
  accent-color: var(--color-accent-brand-default);
}
.resource-row {
  padding: 0.8rem 0;
  border-top: 1px solid var(--color-border-subtle-default);
}
.resource-row-main > div {
  flex: 1;
  min-width: 0;
}
.resource-row strong {
  font-size: 0.86rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.resource-kind {
  font-size: 0.65rem;
  border-radius: 5px;
  background: var(--color-surface-primary-default);
  padding: 0.5rem;
  min-width: 40px;
  text-align: center;
  color: var(--color-text-subtle-default);
}
.resource-actions {
  margin: 0.7rem 0;
}
.resource-shelf h3 {
  font-size: 1rem;
  font-weight: 500;
}
.resource-row a {
  font-size: 0.8rem;
  color: var(--color-text-link-default);
  text-decoration: underline;
}
/* The shelf reads as a list; only the selected resource opens an inspector. */
.resource-shelf { padding: 1rem 1rem .25rem; }
.resource-count { color: var(--color-text-subtle-default); font-size: .8rem; margin-left: .35rem; font-variant-numeric: tabular-nums; }
.resource-row-main { flex-wrap: nowrap; gap: .75rem; }
.resource-row-main :deep(.image-thumbnail), .resource-kind { width: 48px; height: 48px; flex: 0 0 48px; display: grid; place-items: center; }
.resource-row-main .resource-identity { min-width: 0; }
.resource-controls .resource-quiet { border-color: transparent; background: transparent; }
.resource-controls :is(button, input, select):focus-visible { outline: 2px solid var(--color-accent-brand-default); outline-offset: 3px; }
.resource-inspector { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.25rem 2rem; padding: 1rem 0 .25rem 3.75rem; }
.resource-details { display: grid; gap: .7rem; align-content: start; }
.resource-inspector label { max-width: none; }
.resource-placements h4 { font-size: .8rem; font-weight: 500; margin-bottom: .5rem; }
.resource-placements ul { list-style: none; padding: 0; margin: 0; }
.resource-placements li { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .35rem 0; font-size: .8rem; }
.resource-placements small, .resource-delete small { display: block; font-size: .72rem; color: var(--color-text-subtle-default); }
.resource-file-actions { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: start; gap: 1rem; padding-top: .75rem; border-top: 1px solid var(--color-border-subtle-default); }
.resource-file-actions > div:first-child { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.resource-delete { text-align: right; }
.resource-controls .resource-danger { color: var(--color-feedback-error-text-independent-default); }
.resource-link-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource-link-editor { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: .75rem; align-items: end; padding: 1rem 0 .25rem 3.75rem; }
.existing-resource-list { display: grid; gap: .35rem; max-height: 18rem; overflow-y: auto; }
.resource-controls .existing-resource-choice { display: flex; text-align: left; align-items: center; gap: .75rem; padding: .6rem; }
.existing-resource-choice > span:last-child { min-width: 0; }
.existing-resource-choice strong { display: block; overflow-wrap: anywhere; font-weight: 500; }
.existing-resource-choice small { color: var(--color-text-subtle-default); }
.existing-resource-choice[aria-pressed="true"] { border-color: var(--color-accent-brand-default); background: var(--color-surface-subtle-default); }
.existing-resource-choice :deep(.image-thumbnail) { width: 48px; height: 48px; }
.resource-shelf .resource-picker { margin: .5rem 0 1rem; border-radius: 8px; }
.resource-empty { padding: .75rem 0 1rem; color: var(--color-text-subtle-default); font-size: .82rem; }
.resource-picker-tabs { gap: .25rem; padding-bottom: .75rem; border-bottom: 1px solid var(--color-border-subtle-default); }
.resource-picker-tabs button { border-color: transparent; background: transparent; }
.resource-picker-tabs button:last-child { margin-left: auto; }
.resource-picker form > button { justify-self: start; }
@media (max-width: 640px) {
  .resource-inspector { grid-template-columns: 1fr; padding-left: 0; gap: 1rem; }
  .resource-row-main { gap: .4rem; flex-wrap: wrap; }
  .resource-row-main .resource-identity { flex-basis: calc(100% - 60px); }
  .resource-row-main > button:first-of-type, .resource-row-main > a { margin-left: auto; }
  .resource-link-editor { grid-template-columns: 1fr; padding-left: 0; }
  .resource-link-editor > button { justify-self: start; }
  .resource-file-actions { flex-wrap: wrap; }
  .resource-delete { text-align: left; }
}
@media (pointer: coarse) {
  .resource-controls button, .resource-picker button {
    min-height: 44px;
  }
  .resource-controls input,
  .resource-controls select {
    font-size: 16px;
  }
}
</style>
