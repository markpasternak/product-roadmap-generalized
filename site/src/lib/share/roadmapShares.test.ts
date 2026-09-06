import { describe, expect, it } from 'vitest';
import type { AuthoredCanvas } from './canvasdrop';
import {
  isPublishedRoadmapShare,
  isOpenableRoadmapShare,
  isUnpublishableRoadmapShare,
  isVisibleRoadmapShare,
  shareAccessDescription,
  shareAccessLabel,
  shareAccessMode,
  shareAudienceDetail,
  shareEditableAccess,
  sharePublicationLabel,
  sharePublicationStatus,
  shareViewerRoleLabel,
} from './roadmapShares';

const share = (over: Partial<AuthoredCanvas> = {}): AuthoredCanvas => ({
  id: 'S1',
  url: 'https://roadmap.canvas-drop.com/',
  title: 'Roadmap',
  tags: ['roadmap-share'],
  access: 'private',
  accessMode: 'restricted',
  publicationStatus: 'published',
  hasPassword: false,
  status: 'private',
  createdAt: 1,
  updatedAt: 2,
  expiresAt: null,
  revokedAt: null,
  createdBy: 'owner',
  viewerRole: 'owner',
  audienceSummary: { count: 0, names: [] },
  version: 'v1',
  bundleUpdatedAt: 2,
  sourceApp: 'product-roadmap',
  sourceKind: 'roadmap-share',
  metadata: {},
  ...over,
});

describe('roadmap share contract', () => {
  it('keeps audience and publication lifecycle independent', () => {
    const restricted = share({ audienceSummary: { count: 2, names: ['Leadership'] } });

    expect(shareAccessMode(restricted)).toBe('restricted');
    expect(shareAccessLabel(shareAccessMode(restricted))).toBe('Restricted');
    expect(shareAccessDescription(shareAccessMode(restricted))).toContain('owners, editors');
    expect(shareAudienceDetail(restricted)).toBe('2 added people or teams · Team: Leadership');
    expect(sharePublicationStatus(restricted)).toBe('published');
    expect(sharePublicationLabel(sharePublicationStatus(restricted))).toBe('Published');
    expect(isPublishedRoadmapShare(restricted)).toBe(true);
    expect(isOpenableRoadmapShare(restricted)).toBe(true);
    expect(isUnpublishableRoadmapShare(restricted)).toBe(true);
  });

  it('maps all persisted restricted aliases to one editable choice without rewriting an unchanged share', () => {
    for (const access of ['private', 'specific_people', 'team'] as const) {
      const restricted = share({ access, accessMode: undefined });
      expect(shareAccessMode(restricted)).toBe('restricted');
      expect(shareEditableAccess(restricted)).toBe('private');
    }
    expect(shareAccessLabel('password')).toBe('Public link');
  });

  it('falls back safely while an older Canvas Drop response is still in use', () => {
    const legacyPrivate = share({ accessMode: undefined, publicationStatus: undefined });
    const legacyRevoked = share({
      accessMode: undefined,
      publicationStatus: undefined,
      status: 'revoked',
      revokedAt: 10,
    });

    expect(shareAccessMode(legacyPrivate)).toBe('restricted');
    expect(sharePublicationStatus(legacyPrivate)).toBe('published');
    expect(sharePublicationStatus(legacyRevoked)).toBe('unpublished');
  });

  it('hides non-reusable canvas lifecycle states but keeps expired and unpublished shares recoverable', () => {
    expect(isVisibleRoadmapShare(share({ publicationStatus: 'draft', version: null }))).toBe(false);
    expect(isVisibleRoadmapShare(share({ publicationStatus: 'archived' }))).toBe(false);
    expect(isVisibleRoadmapShare(share({ publicationStatus: 'disabled' }))).toBe(false);
    expect(isVisibleRoadmapShare(share({ publicationStatus: 'expired' }))).toBe(true);
    expect(isVisibleRoadmapShare(share({ publicationStatus: 'unpublished' }))).toBe(true);
  });

  it('shows explicit audience additions at wide access modes too', () => {
    const publicShare = share({
      access: 'public_link',
      accessMode: 'public_link',
      audienceSummary: { count: 1, names: ['Roadmap crew'] },
    });

    expect(shareAudienceDetail(publicShare)).toBe('1 added person or team · Team: Roadmap crew');
  });

  it('labels the viewer management role separately from share access', () => {
    expect(shareViewerRoleLabel('owner')).toBe('Canvas owner');
    expect(shareViewerRoleLabel('editor')).toBe('Canvas editor');
    expect(shareViewerRoleLabel('admin')).toBe('Canvas admin');
  });
});
