import { describe, expect, it } from 'vitest';
import { VelocityTracker, decideSwipe, rubberband } from './swipe';

describe('VelocityTracker', () => {
  it('returns 0 with fewer than two samples', () => {
    const tracker = new VelocityTracker();
    expect(tracker.velocity()).toBe(0);
    tracker.add(0, 10);
    expect(tracker.velocity()).toBe(0);
  });

  it('calculates px/ms over the trailing 100ms window', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(80, 80);
    tracker.add(160, 240);
    expect(tracker.velocity(160)).toBe(2);
  });

  it('evicts samples older than the trailing 100ms window', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(100, 100);
    expect(tracker.velocity(100)).toBe(1);
    tracker.add(201, 300);
    expect(tracker.velocity(201)).toBe(0);
  });

  it('resets samples', () => {
    const tracker = new VelocityTracker();
    tracker.add(0, 0);
    tracker.add(40, 40);
    expect(tracker.velocity()).toBe(1);
    tracker.reset();
    expect(tracker.velocity()).toBe(0);
  });

  it('returns 0 when remaining sample times do not advance', () => {
    const tracker = new VelocityTracker();
    tracker.add(10, 0);
    tracker.add(10, 20);
    expect(tracker.velocity()).toBe(0);
  });
});

describe('rubberband', () => {
  it('is sign-preserving', () => {
    expect(rubberband(50, 100)).toBeGreaterThan(0);
    expect(rubberband(-50, 100)).toBeLessThan(0);
  });

  it('is monotonic and approaches the limit', () => {
    const a = rubberband(20, 100);
    const b = rubberband(100, 100);
    const c = rubberband(10000, 100);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(100);
  });

  it('returns 0 for zero offset or invalid limits', () => {
    expect(rubberband(0, 100)).toBe(0);
    expect(rubberband(100, 0)).toBe(0);
  });
});

describe('decideSwipe', () => {
  const base = { width: 300, canPrev: true, canNext: true };

  it('commits a next flick', () => {
    expect(decideSwipe({ ...base, offset: -30, velocity: -0.6 })).toBe('next');
  });

  it('commits a prev flick', () => {
    expect(decideSwipe({ ...base, offset: 30, velocity: 0.6 })).toBe('prev');
  });

  it('commits past half-width with near-zero velocity', () => {
    expect(decideSwipe({ ...base, offset: -151, velocity: 0 })).toBe('next');
    expect(decideSwipe({ ...base, offset: 151, velocity: 0 })).toBe('prev');
  });

  it('commits by projected travel', () => {
    expect(decideSwipe({ ...base, offset: -80, velocity: -0.36 })).toBe('next');
    expect(decideSwipe({ ...base, offset: 80, velocity: 0.36 })).toBe('prev');
  });

  it('cancels when the finger reverses direction before release', () => {
    expect(decideSwipe({ ...base, offset: -200, velocity: 0.1 })).toBe('cancel');
    expect(decideSwipe({ ...base, offset: 200, velocity: -0.1 })).toBe('cancel');
  });

  it('cancels a high-magnitude reversed flick', () => {
    expect(decideSwipe({ ...base, offset: -200, velocity: 0.6 })).toBe('cancel');
    expect(decideSwipe({ ...base, offset: 200, velocity: -0.6 })).toBe('cancel');
  });

  it('cancels a grabbed incoming offset released below threshold with zero velocity', () => {
    expect(decideSwipe({ ...base, offset: 90, velocity: 0 })).toBe('cancel');
    expect(decideSwipe({ ...base, offset: -90, velocity: 0 })).toBe('cancel');
  });

  it('cancels in a direction with no target', () => {
    expect(decideSwipe({ ...base, canNext: false, offset: -240, velocity: -1 })).toBe('cancel');
    expect(decideSwipe({ ...base, canPrev: false, offset: 240, velocity: 1 })).toBe('cancel');
  });

  it('cancels below zero-velocity distance boundaries', () => {
    expect(decideSwipe({ ...base, offset: -149, velocity: 0 })).toBe('cancel');
    expect(decideSwipe({ ...base, offset: 149, velocity: 0 })).toBe('cancel');
  });
});
