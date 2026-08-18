export type SwipeDecision = 'next' | 'prev' | 'cancel';

export interface SwipeDecisionInput {
  offset: number;
  velocity: number;
  width: number;
  canPrev: boolean;
  canNext: boolean;
}

const VELOCITY_WINDOW_MS = 100;
const FLICK_VELOCITY = 0.5;
const PROJECT_MS = 200;
const DISTANCE_RATIO = 0.5;

export class VelocityTracker {
  private samples: { t: number; x: number }[] = [];

  add(t: number, x: number): void {
    this.samples.push({ t, x });
    this.trim(t);
  }

  reset(): void {
    this.samples = [];
  }

  velocity(now = this.samples.at(-1)?.t ?? 0): number {
    this.trim(now);
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }

  private trim(now: number): void {
    const cutoff = now - VELOCITY_WINDOW_MS;
    while (this.samples.length > 1 && this.samples[0]!.t < cutoff) this.samples.shift();
  }
}

export function rubberband(offset: number, limit: number): number {
  if (!offset || limit <= 0) return 0;
  const sign = Math.sign(offset);
  const distance = Math.abs(offset);
  return sign * ((limit * distance) / (limit + distance));
}

export function decideSwipe({ offset, velocity, width, canPrev, canNext }: SwipeDecisionInput): SwipeDecision {
  const direction = offset < 0 ? 'next' : offset > 0 ? 'prev' : velocity < 0 ? 'next' : velocity > 0 ? 'prev' : 'cancel';
  if (direction === 'next' && !canNext) return 'cancel';
  if (direction === 'prev' && !canPrev) return 'cancel';
  if (offset !== 0 && velocity !== 0 && Math.sign(offset) !== Math.sign(velocity)) return 'cancel';

  const projected = offset + velocity * PROJECT_MS;
  const threshold = width * DISTANCE_RATIO;
  if (direction === 'next') {
    if (velocity <= -FLICK_VELOCITY) return 'next';
    if (projected <= -threshold) return 'next';
  } else if (direction === 'prev') {
    if (velocity >= FLICK_VELOCITY) return 'prev';
    if (projected >= threshold) return 'prev';
  }
  return 'cancel';
}
