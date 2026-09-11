/** Headings shown in the concise roadmap and recipient views. */
export const STORY_HEADINGS = ['Why it matters', 'Scope', 'What ships', 'What shipped', 'Bottom line'];

export function sectionLabel(heading: string): string {
  return /^(?:scope|what ships|what shipped)$/i.test(heading) ? 'Scope' : heading;
}

export function isStoryHeading(heading: string): boolean {
  return STORY_HEADINGS.some(value => value.toLowerCase() === heading.toLowerCase());
}
