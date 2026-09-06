<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, provide } from "vue";
import ConfirmAction from "../ui/ConfirmAction.vue";
import ImagePicker from './ImagePicker.vue';
import ImageThumbnail from '../markdown/ImageThumbnail.vue';
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
const props = defineProps<{ body: string; visibility: string }>();
const emit = defineEmits<{ "update:body": [body: string] }>();
const store = useEditStore();
const locked = computed(() => !!store.snapshot().requestPayload);
const loading = ref(true);
const picker = ref<"upload" | "link" | "existing" | null>(null),
  manage = ref(false),
  error = ref(""),
  notice = ref("");
const library = ref<ResourceAsset[]>([]),
  uploads = ref<ResourceUpload[]>([]);
const fileInput = ref<HTMLInputElement>();
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
  anchor?: { text: string; offset: number; length: number };
};
const pending = ref<Pending[]>([]);
let serial = 0,
  loadEpoch = 0;
let bookmark: Pending["anchor"];
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
const rows = computed(() => allAssets.value.filter(a => manage.value || a.placements.length));
function shownRevision(asset: typeof allAssets.value[number]) {
  const used = asset.placements.map(p => repositoryAssetPath(p.href));
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
  const inserted = placeInline(props.body, markdown, bookmark);
  emit('update:body', inserted ?? appendToResourceSection(props.body, 'What ships', markdown));
  notice.value = inserted ? 'Image inserted.' : 'The insertion point changed. Image added to What ships.';
  imagePickerOpen.value = false;
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
const attached = computed(() =>
  rows.value.filter((a) =>
    a.placements.some((p) => ["Resources", "Links"].includes(p.section)),
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
    if (!selection) {
      bookmark = undefined;
      return;
    }
    const left = Math.max(0, selection.from - 80),
      right = Math.min(props.body.length, selection.to + 80);
    bookmark = {
      text: props.body.slice(left, right),
      offset: selection.from - left,
      length: selection.to - selection.from,
    };
    return;
  }
  const start = props.body.indexOf(target.value);
  if (start < 0 || start !== props.body.lastIndexOf(target.value)) {
    bookmark = undefined;
    return;
  }
  const a = start + target.selectionStart,
    b = start + target.selectionEnd;
  const left = Math.max(0, a - 80),
    right = Math.min(props.body.length, b + 80);
  bookmark = {
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
  return appendToResourceSection(body, "What ships", markdown);
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
        ? `${claim.resource.name} is unavailable. Replace it with a new upload, or remove its placements and delete it from Manage resources.`
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
      body = inline ?? attachResource(body, u.name, href);
      notice.value = inline
        ? "File inserted. Edit its text alternative in Markdown."
        : "The insertion point changed. Your file was added to Resources.";
    } else body = attachResource(body, u.name, href);
    emit("update:body", body);
    pending.value = pending.value.filter((p) => p.id !== job.id);
    picker.value = null;
  } catch (e) {
    if ((e as Error).name === "AbortError")
      pending.value = pending.value.filter((p) => p.id !== job.id);
    else job.error = (e as Error).message;
  }
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
      assetId: replaceID.value,
      anchor: inline ? bookmark : undefined,
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
    picker.value = null;
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
  const asset = library.value.find((a) => a.id === selectedExisting.value);
  if (asset) {
    const rev = asset.revisions.at(-1)!;
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
  picker.value = null;
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
function removeUse(asset: ResourceAsset, section: "inline" | "list") {
  let body = props.body;
  const matches = placements.value.filter(
    (p) =>
      repositoryAssetPath(p.href)?.startsWith(`content/assets/${asset.id}/`) &&
      ["Resources", "Links"].includes(p.section) === (section === "list"),
  );
  for (const p of matches.reverse()) body = removeResourcePlacement(body, p);
  emit("update:body", body);
  notice.value = "Placement removed. The file remains available.";
}
function insert(asset: ResourceAsset) {
  const revision = asset.revisions.at(-1)!;
  const href = markdownAssetPath(
    `content/assets/${asset.id}/${revision.original.path}`,
  );
  const md = `${revision.original.mediaType.startsWith("image/") ? "!" : ""}[${markdownLabel(asset.name)}](${href})`;
  emit(
    "update:body",
    placeInline(props.body, md) ?? attachResource(props.body, asset.name, href),
  );
  notice.value = "Inserted in What ships.";
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
      "File marked for deletion. Publish to remove it from the current repository.";
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
async function download(asset: ResourceAsset) {
  const file = asset.revisions.at(-1)!.original;
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
    <fieldset :disabled="locked" class="resource-controls">
      <div class="resource-authoring-toolbar">
        <span>Write-up</span
        ><button
          type="button"
          :aria-expanded="!!picker"
          @mousedown="rememberSelection()"
          @click="picker = picker ? null : 'upload'"
        >
          Add resource
        </button>
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
          ><button type="button" @click="picker = null">Close</button>
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
          <button type="button" @click="fileInput?.click()">
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
          <label
            >File or document<select v-model="selectedExisting" required>
              <option value="" disabled>Choose a resource</option>
              <optgroup label="Uploaded files">
                <option
                  v-for="asset in library"
                  :key="asset.id"
                  :value="asset.id"
                >
                  {{ asset.name }}
                </option>
              </optgroup>
              <optgroup label="Documents">
                <option
                  v-for="doc in documents"
                  :key="doc.path"
                  :value="doc.path"
                >
                  {{ doc.title }}
                </option>
              </optgroup>
            </select></label
          ><button type="submit" :disabled="!selectedExisting">
            Add to Resources
          </button>
        </form>
      </section>
      <input
        ref="fileInput"
        type="file"
        multiple
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
    </fieldset>
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
    <slot />
    <ImagePicker v-if="imagePickerOpen" :images="imageChoices" @insert="insertImage" @cancel="imagePickerOpen = false" />
    <fieldset :disabled="locked" class="resource-controls">
      <section class="resource-shelf" aria-label="Resources">
        <p v-if="loading" role="status" class="resource-muted">
          Loading your resource library…
        </p>
        <div class="resource-shelf-heading">
          <h3>
            Resources
            <span v-if="attached.length + external.length"
              >· {{ attached.length + external.length }}</span
            >
          </h3>
          <button
            type="button"
            :aria-expanded="manage"
            @click="manage = !manage"
          >
            {{ manage ? "Done managing" : "Manage resources" }}
          </button>
        </div>
        <p
          v-if="!loading && !rows.length && !external.length"
          class="resource-muted"
        >
          Keep supporting files and links with this item.
        </p>
        <article
          v-for="asset in manage ? rows : attached"
          :key="asset.id"
          class="resource-row"
        >
          <div class="resource-row-main">
            <ImageThumbnail v-if="shownRevision(asset).original.mediaType.startsWith('image/')" :href="imageHref(asset)" authenticated />
            <span v-else class="resource-kind">{{
              asset.revisions.at(-1)?.original.mediaType.startsWith("image/")
                ? "Image"
                : asset.revisions
                    .at(-1)
                    ?.original.path.split(".")
                    .pop()
                    ?.toUpperCase()
            }}</span>
            <div>
              <strong>{{ asset.name }}</strong
              ><span v-if="asset.remove" class="resource-muted">
                · Marked for deletion</span
              >
              <p class="resource-muted">
                {{ readableBytes(asset.revisions.at(-1)?.original.bytes ?? 0) }}
                · {{ asset.sha ? "Published" : "Ready in draft"
                }}<template v-if="manage">
                  ·
                  {{
                    asset.placements.length
                      ? [
                          ...new Set(
                            asset.placements.map(
                              (p) => p.section || "Write-up",
                            ),
                          ),
                        ].join(", ")
                      : "Not used in this item"
                  }}</template
                >
              </p>
            </div>
            <button type="button" @click="download(asset)">Download</button>
          </div>
          <button
            v-if="asset.remove"
            type="button"
            @click="
              store.setAssets({
                ...dirtyAssets(),
                update: dirtyAssets().update.filter((c) => c.id !== asset.id),
              })
            "
          >
            Undo deletion
          </button>
          <p
            v-if="visibility === 'Public' && asset.visibility !== 'Public'"
            class="resource-error"
          >
            This file is Internal.
            <button type="button" @click="makePublic(asset)">
              Make file public
            </button>
          </p>
          <details v-if="manage && !asset.remove">
            <summary>Edit and manage</summary>
            <label
              >Display name<input
                :value="asset.name"
                @change="
                  rename(asset, ($event.target as HTMLInputElement).value)
                " /></label
            ><label
              v-for="placement in asset.placements.filter((p) => p.image)"
              :key="placement.start"
              >Image description<input
                :value="placement.label"
                placeholder="Describe what the image shows"
                @change="
                  editAlt(
                    placement.start,
                    ($event.target as HTMLInputElement).value,
                  )
                "
            /></label>
            <div class="resource-actions">
              <button type="button" @click="insert(asset)">
                Insert in What ships</button
              ><button
                v-if="
                  asset.placements.some(
                    (p) => !['Resources', 'Links'].includes(p.section),
                  )
                "
                type="button"
                @click="removeUse(asset, 'inline')"
              >
                Remove from text</button
              ><button
                v-if="
                  asset.placements.some((p) =>
                    ['Resources', 'Links'].includes(p.section),
                  )
                "
                type="button"
                @click="removeUse(asset, 'list')"
              >
                Remove from Resources</button
              ><button
                v-else
                type="button"
                @click="
                  emit(
                    'update:body',
                    attachResource(
                      body,
                      asset.name,
                      markdownAssetPath(
                        `content/assets/${asset.id}/${asset.revisions.at(-1)!.original.path}`,
                      ),
                    ),
                  )
                "
              >
                List in Resources</button
              ><button
                type="button"
                @click="
                  replaceID = asset.id;
                  fileInput?.click();
                "
              >
                Replace file</button
              ><button
                v-if="visibility === 'Public' && asset.visibility !== 'Public'"
                type="button"
                @click="makePublic(asset)"
              >
                Make file public</button
              ><button
                type="button"
                :disabled="!!asset.placements.length"
                @click="deleteAsset = asset"
              >
                Delete file…
              </button>
            </div>
            <p v-if="asset.usages?.length" class="resource-muted">
              Repository uses: {{ asset.usages.join(", ") }}
            </p>
          </details>
        </article>
        <article
          v-for="link in external"
          :key="link.start"
          class="resource-row resource-row-main"
        >
          <ImageThumbnail v-if="link.image || isImageResource(link.href)" :href="link.href" />
          <div>
            <template v-if="manage"
              ><label
                >Name<input
                  :value="link.label"
                  @change="
                    editExternal(
                      link.start,
                      'label',
                      ($event.target as HTMLInputElement).value,
                    )
                  " /></label
              ><label
                >Link<input
                  :value="link.href"
                  @change="
                    editExternal(
                      link.start,
                      'href',
                      ($event.target as HTMLInputElement).value,
                    )
                  " /></label></template
            ><template v-else
              ><strong>{{ link.label }}</strong>
              <p class="resource-muted">{{ link.href }}</p></template
            >
          </div>
          <a :href="resourceHref(link.href)" target="_blank" rel="noopener"
            >Open</a
          ><button
            type="button"
            @click="emit('update:body', removeResourcePlacement(body, link))"
          >
            Remove
          </button>
        </article>
      </section>
    </fieldset>
    <ConfirmAction
      v-if="deleteAsset"
      title="Delete this file?"
      message="This removes an unused file from the current repository when you publish. Earlier Git commits and existing shared snapshots may still contain it."
      confirm-label="Mark for deletion"
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
.resource-authoring-toolbar,
.resource-shelf-heading,
.resource-row-main,
.resource-picker-tabs,
.resource-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.resource-authoring-toolbar,
.resource-shelf-heading {
  justify-content: space-between;
  margin-bottom: 0.8rem;
}
.resource-authoring-toolbar > span {
  font-size: 0.8rem;
  color: var(--color-text-subtle-default);
}
.resource-authoring button,
.resource-authoring input,
.resource-authoring select {
  font: inherit;
}
.resource-authoring button {
  min-height: 38px;
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 7px;
  background: var(--color-card);
  padding: 0.4rem 0.7rem;
  font-size: 0.8rem;
  color: var(--color-text-primary-default);
  cursor: pointer;
}
.resource-authoring button:disabled {
  opacity: 0.45;
  cursor: default;
}
.resource-authoring button:hover:not(:disabled) {
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
.resource-authoring label {
  display: grid;
  gap: 0.3rem;
  font-size: 0.8rem;
  max-width: 480px;
}
.resource-authoring input,
.resource-authoring select {
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
  min-width: 140px;
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
.resource-row details {
  margin-top: 0.5rem;
}
.resource-row summary {
  font-size: 0.78rem;
  color: var(--color-accent-brand-default);
  cursor: pointer;
  padding: 0.3rem 0;
  min-height: 28px;
}
.resource-row details label {
  margin: 0.5rem 0;
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
@media (pointer: coarse) {
  .resource-authoring button {
    min-height: 44px;
  }
  .resource-authoring input,
  .resource-authoring select {
    font-size: 16px;
  }
}
</style>
