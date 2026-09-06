import type { InjectionKey } from "vue";

/** The resource owner captures the editor selection before opening the picker. */
export const insertImageKey: InjectionKey<
  (target?: HTMLTextAreaElement) => void
> = Symbol("insert-image");

export interface ImageChoice {
  href: string;
  name: string;
  attached: boolean;
}
