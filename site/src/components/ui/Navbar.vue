<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { PhGithubLogo } from '@phosphor-icons/vue';
import Avatar from './Avatar.vue';
import Select from './Select.vue';
import { getCanvasdrop, type Me } from '../../lib/share/canvasdrop';
import { EDIT_API, me, loginUrl, readTokenFromHash, rememberSignInLocation } from '../../lib/edit/client';
import { IS_PUBLIC } from '../../lib/audience';

defineProps<{ base: string; active?: 'roadmap' | 'shares' | 'docs' | 'help' }>();
const author = ref<Me | null>(null);
const authorName = computed(() => author.value?.name || author.value?.email || 'Signed-in author');
const accountOpen = ref(false);
const accountWrap = ref<HTMLElement>();
const editor = ref<{ editor: boolean; login: string } | null>(null);
const checkingEditor = ref(false);
const editorError = ref(false);
const appearance = ref('light');
const appearanceOptions = [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

function setAppearance(value: string) {
  appearance.value = value;
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('rm-theme', value); } catch { /* Still apply for this page. */ }
}
function closeAccount(returnFocus = false) {
  accountOpen.value = false;
  if (returnFocus) accountWrap.value?.querySelector<HTMLButtonElement>('button')?.focus();
}
function toggleAccount() {
  accountOpen.value = !accountOpen.value;
  if (!accountOpen.value) return;
  appearance.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  if (!IS_PUBLIC) void checkEditingAccess();
}
async function checkEditingAccess() {
  if (checkingEditor.value) return;
  checkingEditor.value = true;
  editorError.value = false;
  try { editor.value = await me(); }
  catch { editorError.value = true; }
  finally { checkingEditor.value = false; }
}
function onPointer(event: PointerEvent) {
  if (event.target instanceof Node && !accountWrap.value?.contains(event.target)) closeAccount();
}
function onFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !accountWrap.value?.contains(event.relatedTarget)) closeAccount();
}
onMounted(async () => {
  // Account sign-in is available on support pages too; consume their OAuth callback
  // through the same helper used by the board before rendering editing access.
  if (!IS_PUBLIC) readTokenFromHash();
  appearance.value = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  document.addEventListener('pointerdown', onPointer);
  if (IS_PUBLIC) return;
  const cd = getCanvasdrop();
  if (!cd) return;
  try { author.value = await cd.me(); }
  catch { author.value = null; }
});
onUnmounted(() => document.removeEventListener('pointerdown', onPointer));

const link = 'roadmap-action relative inline-flex h-10 items-center border-b-2 px-2.5 sm:px-3.5 text-single-base-medium transition-colors';
const activeCls = 'border-[color:var(--color-accent-brand-default)] text-[color:var(--color-accent-brand-default)]';
const idleCls = 'border-transparent text-text-primary-default hover:text-[color:var(--color-accent-brand-default)]';
const navigation = [{ key: 'roadmap', label: 'Roadmap', path: '' }, { key: 'shares', label: 'Shares', path: 'shares' }, { key: 'help', label: 'Help', path: 'help' }];
</script>

<template>
  <header class="site-navbar border-border-subtle-default/70 bg-card sticky top-0 z-40 border-b">
    <div class="site-navigation-layout mx-auto grid min-h-16 max-w-[1600px] grid-cols-[auto_1fr_auto] items-center px-4 sm:px-6">
      <a :href="base" class="flex h-full items-center border-r border-border-subtle-default/70 pr-5" aria-label="Product Roadmap">
        <span class="site-brand-tile"><img :src="base + 'brand/roadmap-logo.svg'" alt="Product Roadmap" class="h-[26px] w-auto object-contain" width="36" height="36" /></span>
      </a>
      <nav class="flex h-full min-w-0 items-center px-1 sm:px-4" aria-label="Primary">
        <a v-for="item in navigation" :key="item.key" :href="base + item.path"
          :aria-current="active === item.key ? 'page' : undefined" :class="[link, active === item.key ? activeCls : idleCls]">{{ item.label }}</a>
        <a href="https://github.com/markpasternak/product-roadmap-generalized"
          target="_blank" rel="noopener noreferrer" :class="[link, idleCls, 'gap-1.5']"
          aria-label="View source on GitHub (opens in a new tab)">
          <PhGithubLogo :size="18" aria-hidden="true" />GitHub
        </a>
      </nav>
      <div ref="accountWrap" class="site-account" @keydown.esc.stop.prevent="closeAccount(true)" @focusout="onFocusOut">
        <button type="button" class="account-trigger roadmap-action" :aria-label="IS_PUBLIC || !EDIT_API ? 'Appearance' : 'Account'" :aria-expanded="accountOpen" aria-controls="site-account-panel" @click="toggleAccount">
          <Avatar v-if="author && !IS_PUBLIC" :name="authorName" :size="22" />
          {{ IS_PUBLIC || !EDIT_API ? 'Appearance' : 'Account' }}<span class="disclosure-caret" aria-hidden="true"></span>
        </button>
        <div v-if="accountOpen" id="site-account-panel" class="control-popover account-panel">
          <div v-if="author && !IS_PUBLIC" class="account-section account-identity">
            <strong>{{ authorName }}</strong>
            <span v-if="author.email && author.email !== authorName">{{ author.email }}</span>
            <span>Signed in for sharing</span>
          </div>
          <div v-if="!IS_PUBLIC && EDIT_API" class="account-section">
            <span class="account-label">Roadmap editing</span>
            <p v-if="checkingEditor" role="status">Checking editing access…</p>
            <template v-else-if="editorError">
              <p role="alert">Couldn’t check editing access.</p>
              <button type="button" class="account-sign-in roadmap-primary-action" @click="checkEditingAccess">Try again</button>
            </template>
            <template v-else-if="editor?.editor">
              <strong>Editing enabled</strong>
              <p>GitHub · {{ editor.login }}</p>
            </template>
            <template v-else-if="editor?.login">
              <strong>View-only access</strong>
              <p>GitHub · {{ editor.login }}</p>
            </template>
            <template v-else>
              <a :href="loginUrl()" class="account-sign-in roadmap-primary-action" @click="rememberSignInLocation">Sign in to edit</a>
              <p>Uses your GitHub account.</p>
            </template>
          </div>
          <div class="account-section">
            <label for="site-appearance" class="account-label">Appearance</label>
            <Select id="site-appearance" :model-value="appearance" :options="appearanceOptions" @update:model-value="setAppearance" />
          </div>
        </div>
      </div>
    </div>
  </header>
</template>
