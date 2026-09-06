import { onUnmounted, ref } from 'vue';

/** Keep clipboard feedback truthful, including after switching items or unmounting. */
export function useClipboard() {
  const copied = ref(false);
  const copying = ref(false);
  const copyError = ref('');
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function resetCopy() {
    sequence += 1;
    clearTimeout(timer);
    copied.value = false;
    copying.value = false;
    copyError.value = '';
  }

  async function copy(value: string): Promise<boolean> {
    resetCopy();
    const request = sequence;
    copying.value = true;
    try {
      await navigator.clipboard.writeText(value);
      if (request !== sequence) return false;
      copied.value = true;
      timer = setTimeout(() => (copied.value = false), 2500);
      return true;
    } catch {
      if (request === sequence) copyError.value = 'Couldn’t copy the link. Check your browser’s clipboard permission and try again.';
      return false;
    } finally {
      if (request === sequence) copying.value = false;
    }
  }

  onUnmounted(resetCopy);
  return { copy, copied, copying, copyError, resetCopy };
}
