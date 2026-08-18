import { describe, it, expect } from 'vitest';
import { sectionDiff } from './sectionDiff';
import type { Section } from '../edit/sections';

describe('sectionDiff', () => {
  it('flags a changed section, an added-content section, and leaves untouched sections unchanged', () => {
    const current: Section[] = [
      { heading: 'One-liner', body: 'Let editors bulk-tag items.' },
      { heading: 'Why it matters', body: 'Retagging one at a time is slow.' },
      { heading: 'Open questions', body: '' },
      { heading: 'What ships', body: 'A multi-select and a bulk tag panel.' },
    ];
    const rewritten: Section[] = [
      { heading: 'One-liner', body: 'Let editors bulk-tag items.' }, // identical
      { heading: 'Why it matters', body: 'Retagging one at a time after a taxonomy change is slow and error-prone.' }, // changed
      { heading: 'Open questions', body: 'Should a bulk edit count as one dirty entry or N?' }, // added (was blank)
      { heading: 'What ships', body: 'A multi-select and a bulk tag panel.' }, // identical
    ];

    const diff = sectionDiff(current, rewritten);

    expect(diff).toHaveLength(4);
    expect(diff.find((d) => d.key === 'One-liner')).toMatchObject({ status: 'unchanged' });
    expect(diff.find((d) => d.key === 'Why it matters')).toMatchObject({
      status: 'changed',
      before: 'Retagging one at a time is slow.',
      after: 'Retagging one at a time after a taxonomy change is slow and error-prone.',
    });
    expect(diff.find((d) => d.key === 'Open questions')).toMatchObject({
      status: 'added',
      before: '',
      after: 'Should a bulk edit count as one dirty entry or N?',
    });
    expect(diff.find((d) => d.key === 'What ships')).toMatchObject({ status: 'unchanged' });
  });

  it('treats a section missing from the rewrite as unchanged against its own original body', () => {
    const current: Section[] = [
      { heading: 'One-liner', body: 'Original text.' },
      { heading: 'Why it matters', body: 'Original reasoning.' },
    ];
    // The rewrite dropped "Why it matters" entirely (KTD1's tolerant parse would have
    // already re-inserted the original body before this ever reaches sectionDiff, but
    // this covers the diff logic's own fallback independently).
    const rewritten: Section[] = [{ heading: 'One-liner', body: 'Updated text.' }];

    const diff = sectionDiff(current, rewritten);

    expect(diff.find((d) => d.key === 'One-liner')).toMatchObject({ status: 'changed', after: 'Updated text.' });
    expect(diff.find((d) => d.key === 'Why it matters')).toMatchObject({
      status: 'unchanged',
      before: 'Original reasoning.',
      after: 'Original reasoning.',
    });
  });

  it('matches headings case-insensitively', () => {
    const current: Section[] = [{ heading: 'Why it matters', body: 'Old.' }];
    const rewritten: Section[] = [{ heading: 'why it MATTERS', body: 'New.' }];

    const diff = sectionDiff(current, rewritten);

    expect(diff).toEqual([{ key: 'Why it matters', status: 'changed', before: 'Old.', after: 'New.' }]);
  });
});
