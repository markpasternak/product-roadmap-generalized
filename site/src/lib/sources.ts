// Resolve a link (its label + optional URL) to a recognizable source: brand icon,
// friendly name, tone, and a short display string (host, never a raw URL). Shared by
// the item page, the drawer, and the filters sidebar so a "Notion card" looks the
// same everywhere. Detection is host-first (a Figma URL wins) then label keywords
// (the filters sidebar only has a label), then a generic doc/link fallback.
import {
  PhNotionLogo,
  PhFigmaLogo,
  PhSlackLogo,
  PhGoogleDriveLogo,
  PhGithubLogo,
  PhGitlabLogo,
  PhYoutubeLogo,
  PhDropboxLogo,
  PhMicrosoftWordLogo,
  PhMicrosoftExcelLogo,
  PhMicrosoftPowerpointLogo,
  PhMicrosoftTeamsLogo,
  PhFilePdf,
  PhTable,
  PhPresentation,
  PhGlobe,
  PhFileMagnifyingGlass,
  PhPaintBrush,
  PhCode,
  PhFileText,
  PhFolderOpen,
  PhLinkSimple,
} from '@phosphor-icons/vue';
import type { Tone } from './display';

export interface SourceMeta {
  /** Friendly source name, e.g. "Notion", "Figma", "Google Slides". */
  name: string;
  /** Phosphor icon component (typed loose so it renders in both Astro and Vue). */
  Icon: unknown;
  tone: Tone;
}

/** Hostname without `www.`, or '' when target is missing/not a URL. */
export function hostOf(target?: string): string {
  if (!target) return '';
  try {
    return new URL(target).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Text to show for a link's target: never a raw URL — a doc title, host, or filename. */
export function linkDisplay(_label: string, target: string, title?: string | null): string {
  if (title) return title;
  const host = hostOf(target);
  if (host) return host;
  return target.split('/').filter(Boolean).pop() ?? target;
}

const meta = (name: string, Icon: unknown, tone: Tone): SourceMeta => ({ name, Icon, tone });

/**
 * Map a link to its source. Pass the target URL when available (host detection is
 * the most reliable); the filters sidebar passes only a label, which still resolves
 * common types by keyword.
 */
export function linkSource(label: string, target?: string): SourceMeta {
  const host = hostOf(target);
  const url = (target ?? '').toLowerCase();
  const l = label.toLowerCase();
  const has = (re: RegExp) => re.test(host) || re.test(l);

  // Google surfaces — split by product path so the icon fits the document kind.
  if (/docs\.google\.com\/presentation/.test(url) || l.includes('google slides'))
    return meta('Google Slides', PhPresentation, 'yellow');
  if (/docs\.google\.com\/spreadsheets/.test(url) || l.includes('google sheets'))
    return meta('Google Sheets', PhTable, 'green');
  if (/docs\.google\.com\/document/.test(url) || l.includes('google doc'))
    return meta('Google Doc', PhFileText, 'blue');
  if (has(/drive\.google|google drive/)) return meta('Google Drive', PhGoogleDriveLogo, 'green');

  // Named tools / brands.
  if (has(/notion/)) return meta('Notion', PhNotionLogo, 'gray');
  if (has(/figma/)) return meta('Figma', PhFigmaLogo, 'violet');
  if (has(/slack/)) return meta('Slack', PhSlackLogo, 'violet');
  if (has(/github/)) return meta('GitHub', PhGithubLogo, 'gray');
  if (has(/gitlab/)) return meta('GitLab', PhGitlabLogo, 'orange');
  if (has(/youtube|youtu\.be|loom|vimeo/)) return meta('Video', PhYoutubeLogo, 'red');
  if (has(/dropbox/)) return meta('Dropbox', PhDropboxLogo, 'blue');
  if (has(/teams\.microsoft|microsoft teams/)) return meta('Microsoft Teams', PhMicrosoftTeamsLogo, 'violet');
  if (has(/\.docx?\b|microsoft word|\bword\b/)) return meta('Word', PhMicrosoftWordLogo, 'blue');
  if (has(/\.xlsx?\b|\.csv\b|microsoft excel|\bexcel\b/)) return meta('Excel', PhMicrosoftExcelLogo, 'green');
  if (has(/\.pptx?\b|powerpoint/)) return meta('PowerPoint', PhMicrosoftPowerpointLogo, 'yellow');
  if (has(/\.pdf\b/)) return meta('PDF', PhFilePdf, 'red');

  // Roadmap document kinds (label-driven; these come from the item's Links section).
  if (l.includes('prd')) return meta('PRD', PhFileText, 'orange');
  if (l.includes('research')) return meta('Research', PhFileMagnifyingGlass, 'green');
  if (l.includes('microsite')) return meta('Microsite', PhGlobe, 'green');
  if (l.includes('proposal') || l.includes('deck') || l.includes('presentation'))
    return meta('Presentation', PhPresentation, 'violet');
  if (l.includes('technical') || l.includes('code')) return meta('Technical', PhCode, 'blue');
  if (l.includes('design')) return meta('Design', PhPaintBrush, 'blue');
  if (l.includes('folder') || l.includes('any')) return meta('Resource', PhFolderOpen, 'gray');

  // Generic fallbacks.
  if (host) return meta('Link', PhLinkSimple, 'gray');
  return meta('Document', PhFileText, 'gray');
}
