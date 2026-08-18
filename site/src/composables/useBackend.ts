// Availability composable (KTD3): every AI/presence surface is gated purely
// by feature-detecting the presence of `getCanvasdrop()?.ai` /
// `getCanvasdrop()?.realtime` — no probing calls, no errors, safe when the
// canvas Backend isn't loaded (local dev) or the accessor is simply absent.
import { computed, type ComputedRef } from 'vue';
import { getCanvasdrop } from '../lib/share/canvasdrop';

export interface BackendAvailability {
  aiAvailable: ComputedRef<boolean>;
  realtimeAvailable: ComputedRef<boolean>;
}

/** Fresh, lazily-evaluated availability refs for the calling component. Each
 * call creates its own computed pair so re-checking (e.g. on remount, or in
 * tests after mocking `globalThis.canvasdrop`) always reflects current state. */
export function useBackend(): BackendAvailability {
  const aiAvailable = computed(() => !!getCanvasdrop()?.ai);
  const realtimeAvailable = computed(() => !!getCanvasdrop()?.realtime);
  return { aiAvailable, realtimeAvailable };
}
