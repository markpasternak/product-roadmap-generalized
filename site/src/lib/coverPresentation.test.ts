import { describe, expect, it } from 'vitest';
import { coverFramingLabel, coverPresentationCss, coverPresentationStyle, normalizeCoverFraming } from './coverPresentation';

describe('cover presentation', () => {
  it('normalizes framing and describes its meaningful stops', () => {
    expect(normalizeCoverFraming('nope')).toBe(0);
    expect(normalizeCoverFraming(-2)).toBe(-1);
    expect(normalizeCoverFraming(2)).toBe(1);
    expect(coverFramingLabel(-1)).toBe('Show full image');
    expect(coverFramingLabel(-0.6)).toBe('Reveal more');
    expect(coverFramingLabel(0)).toBe('Fill card');
    expect(coverFramingLabel(0.5)).toBe('Close-up');
  });

  it('uses the same variables for full-image, fill, and close-up crops', () => {
    expect(coverPresentationStyle('25% 75%', -1)).toMatchObject({ '--cover-position': '25% 75%', '--cover-fill-opacity': '0', '--cover-reveal-opacity': '1', '--cover-reveal-scale': '1' });
    expect(coverPresentationStyle('bad', 0)).toMatchObject({ '--cover-position': '50% 50%', '--cover-fill-scale': '1', '--cover-fill-opacity': '1', '--cover-reveal-opacity': '0' });
    expect(coverPresentationStyle('50% 33%', 1)['--cover-fill-scale']).toBe('1.65');
    expect(coverPresentationCss('25% 75%', -1)).toContain('--cover-position:25% 75%');
  });
});
