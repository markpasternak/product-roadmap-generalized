// ABOUTME: Utility for merging Tailwind CSS classes with conflict resolution.
// ABOUTME: Configures tailwind-merge to understand our custom typography tokens.

import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'single-xs',
            'single-sm',
            'single-sm-medium',
            'single-base',
            'single-base-medium',
            'single-base-semibold',
            'single-lg-semibold',
            'body-sm',
            'body-sm-semibold',
            'body-md',
            'body-md-semibold',
            'body-lg',
            'body-lg-semibold',
            'subtitle-sm',
            'subtitle-sm-semibold',
            'subtitle-md',
            'subtitle-md-semibold',
            'subtitle-lg',
            'subtitle-lg-semibold',
            'heading-md',
            'heading-md-semibold',
            'heading-lg',
            'heading-lg-semibold',
          ],
        },
      ],
      'text-color': [
        {
          text: [
            'text-primary-default',
            'text-primary-hover',
            'text-primary-active',
            'text-primary-disabled',
            'text-subtle-default',
            'text-subtle-hover',
            'text-subtle-active',
            'text-subtle-disabled',
            'text-link-default',
            'text-link-hover',
            'text-link-active',
            'text-link-disabled',
            'text-primary-inverted-default',
            'text-primary-inverted-hover',
            'text-primary-inverted-active',
            'text-primary-inverted-disabled',
            'text-subtle-inverted-default',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const htmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => htmlEscapeMap[ch]!);
}
