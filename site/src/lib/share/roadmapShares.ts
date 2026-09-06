import type { AccessMode, AccessRung, AuthoredCanvas, PublicationStatus, ShareAudience } from './canvasdrop';
import { formatDateTime } from '../dates';

export const SHARE_SOURCE_APP = 'product-roadmap';
export const SHARE_SOURCE_KIND = 'roadmap-share';
export const SHARE_TAG = 'roadmap-share';

export function shareAccessMode(share: AuthoredCanvas): AccessMode {
  if (share.accessMode) return share.accessMode;
  if (share.access === 'whole_org' || share.access === 'public_link') return share.access;
  return 'restricted';
}

/** Prefer Canvas Drop's canonical lifecycle. The fallback keeps a roadmap baked against
 * an older deployment truthful during a staggered rollout: a persisted `private` rung is
 * still a published canvas, not a lifecycle state. */
export function sharePublicationStatus(share: AuthoredCanvas, now = Date.now()): PublicationStatus {
  if (share.publicationStatus) return share.publicationStatus;
  if (share.revokedAt !== null || share.status === 'revoked') return 'unpublished';
  if (share.version === null) return 'draft';
  if (share.status === 'expired' || (share.expiresAt !== null && share.expiresAt <= now)) return 'expired';
  return 'published';
}

export function isPublishedRoadmapShare(share: AuthoredCanvas): boolean {
  return sharePublicationStatus(share) === 'published';
}

/** Managers can still open an expired canvas; ordinary recipients cannot. */
export function isOpenableRoadmapShare(share: AuthoredCanvas): boolean {
  const status = sharePublicationStatus(share);
  return status === 'published' || status === 'expired';
}

export function isUnpublishableRoadmapShare(share: AuthoredCanvas): boolean {
  const status = sharePublicationStatus(share);
  return status === 'published' || status === 'expired';
}

export function isUpdateableRoadmapShare(share: AuthoredCanvas): boolean {
  const status = sharePublicationStatus(share);
  return status === 'published' || status === 'expired' || status === 'unpublished';
}

/** Current Canvas Drop omits archived, deleted, and disabled canvases from list(). Keep
 * the client guard for older/mixed deployments; expired and unpublished shares remain
 * visible because the authoring API can recover them in place. */
export function isVisibleRoadmapShare(share: AuthoredCanvas): boolean {
  return !['draft', 'archived', 'disabled', 'deleted'].includes(sharePublicationStatus(share));
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

export function shareHasPassword(share: AuthoredCanvas): boolean {
  return share.hasPassword === true;
}

/** The three General-access choices the roadmap can edit. Explicit people and teams are
 * independent and stay managed by Canvas Drop; legacy restricted aliases display as the
 * canonical Restricted choice without being rewritten unless the user changes it. */
export function shareEditableAccess(share: AuthoredCanvas): AccessRung {
  const mode = shareAccessMode(share);
  return mode === 'restricted' ? 'private' : mode;
}

function accessModeOf(access: AccessMode | ShareAudience | AccessRung): AccessMode {
  if (access === 'whole_org' || access === 'public_link') return access;
  if (access === 'password') return 'public_link';
  return 'restricted';
}

export function shareAccessLabel(access: AccessMode | ShareAudience | AccessRung): string {
  return (
    {
      public_link: 'Public link',
      whole_org: 'Whole org',
      restricted: 'Restricted',
    } satisfies Record<AccessMode, string>
  )[accessModeOf(access)];
}

export function shareAccessDescription(access: AccessMode | ShareAudience | AccessRung): string {
  return (
    {
      public_link: 'Anyone with the link can view the static roadmap; added people and teams keep full access',
      whole_org: 'Anyone in your org, plus added people and teams',
      restricted: 'Only owners, editors, and people or teams added in Canvas Drop',
    } satisfies Record<AccessMode, string>
  )[accessModeOf(access)];
}

export function shareAudienceDetail(share: AuthoredCanvas): string {
  const count = share.audienceSummary?.count;
  const names = share.audienceSummary?.names?.filter(Boolean) ?? [];
  if (count === undefined || count === null) return names.length ? `Teams: ${names.join(', ')}` : '';
  if (count === 0) return shareAccessMode(share) === 'restricted' ? 'No viewer audience added' : '';
  const audience = count === 1 ? '1 added person or team' : `${count} added people or teams`;
  const teams = names.length ? `${names.length === 1 ? 'Team' : 'Teams'}: ${names.join(', ')}` : '';
  return [audience, teams].filter(Boolean).join(' · ');
}

export function sharePublicationLabel(status: PublicationStatus): string {
  return (
    {
      draft: 'Draft',
      published: 'Published',
      expired: 'Expired',
      unpublished: 'Unpublished',
      archived: 'Archived',
      disabled: 'Disabled',
      deleted: 'Deleted',
    } satisfies Record<PublicationStatus, string>
  )[status];
}

/** A Canvas Drop management role is separate from the audience that can open a share. */
export function shareViewerRoleLabel(role: AuthoredCanvas['viewerRole']): string {
  if (!role) return '';
  return (
    {
      owner: 'Canvas owner',
      editor: 'Canvas editor',
      admin: 'Canvas admin',
    } satisfies Record<NonNullable<AuthoredCanvas['viewerRole']>, string>
  )[role];
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
