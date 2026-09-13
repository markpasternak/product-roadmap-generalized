import { computed, inject, onUnmounted, ref, shallowReactive, type InjectionKey, type Ref, type ShallowRef } from 'vue';
import type { PublishedCandidate, RefreshStatus } from './client';

export function createPublishedContext(current: ShallowRef<PublishedCandidate>, refresh = () => {}) {
  const guards = shallowReactive(new Set<() => boolean>());
  const blocked = computed(() => [...guards].some(guard => guard()));
  const status = ref<RefreshStatus>('current');
  return {
    current, status, blocked, refresh,
    guard(check: () => boolean) { guards.add(check); return () => guards.delete(check); },
  };
}
export type PublishedContext = ReturnType<typeof createPublishedContext>;
export const publishedContextKey: InjectionKey<PublishedContext> = Symbol('published-content');
export function usePublishedContent() { return inject(publishedContextKey, null); }
export function guardPublishedContent(blocked: Readonly<Ref<boolean>>) {
  const context = usePublishedContent();
  if (context) onUnmounted(context.guard(() => blocked.value));
  return context;
}
