import type { AccessRung, AuthoredCanvas } from './canvasdrop';
import { formatDateTime } from '../dates';

export const SHARE_SOURCE_APP = 'product-roadmap';
export const SHARE_SOURCE_KIND = 'roadmap-share';
export const SHARE_TAG = 'roadmap-share';

export function isLiveRoadmapShare(share: AuthoredCanvas): boolean {
  return share.status === 'live';
}

export function shareDate(ms: number | null | undefined): string {
  if (!ms) return 'No expiry';
  return formatDateTime(ms);
}

export function shareMetaString(share: AuthoredCanvas, key: string): string {
  const value = share.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

export function shareMetaNumber(share: AuthoredCanvas, key: string): number | null {
  const value = share.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function shareRoadmapTitle(share: AuthoredCanvas): string {
  return shareMetaString(share, 'roadmapTitle') || share.title;
}

export function shareCanvasTitle(share: AuthoredCanvas): string {
  return share.title || shareRoadmapTitle(share);
}

export function shareAccessLabel(access: AccessRung): string {
  return ({
    public_link: 'Public link',
    whole_org: 'Whole org',
    specific_people: 'Whole org',
    password: 'Password protected',
    private: 'Private',
  } satisfies Record<AccessRung, string>)[access];
}

export function shareAccessDescription(access: AccessRung): string {
  return ({
    public_link: 'Anyone with the link',
    whole_org: 'Signed-in org members',
    specific_people: 'Signed-in org members',
    password: 'Link requires a password',
    private: 'Only you',
  } satisfies Record<AccessRung, string>)[access];
}

export function shareCanvasHref(share: AuthoredCanvas): string {
  const encodedId = encodeURIComponent(share.id);
  try {
    const url = new URL(share.url);
    const hostname = url.hostname.toLowerCase();
    if (hostname.endsWith('.canvas-drop.com')) {
      return `${url.protocol}//canvas-drop.com/canvases/${encodedId}`;
    }
    return `${url.origin}/canvases/${encodedId}`;
  } catch {
    return `/canvases/${encodedId}`;
  }
}
