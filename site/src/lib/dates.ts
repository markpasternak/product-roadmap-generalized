const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function validDate(value: Date | number | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoDateOnly(value: Date | number | string | null | undefined): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (m) return m[1]!;
  }
  const date = validDate(value);
  return date ? date.toISOString().slice(0, 10) : String(value);
}

export function formatDateOnly(value: Date | number | string | null | undefined): string {
  const iso = isoDateOnly(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

export function isoDateTime(value: Date | number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const date = validDate(value);
  return date ? date.toISOString() : String(value);
}

export function formatDateTime(
  value: Date | number | string | null | undefined,
  opts: { timeZone?: string; suffix?: string } = {},
): string {
  if (value == null || value === '') return '';
  const date = validDate(value);
  if (!date) return String(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: opts.timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const formatted = `${get('month')} ${Number(get('day'))}, ${get('year')}, ${get('hour')}:${get('minute')}`;
  return opts.suffix ? `${formatted} ${opts.suffix}` : formatted;
}

export function formatDateTimeOrDate(
  value: Date | number | string | null | undefined,
  fallbackDate: Date | number | string | null | undefined = value,
  opts: { timeZone?: string; suffix?: string } = {},
): string {
  return formatDateTime(value, opts) || formatDateOnly(fallbackDate);
}

/** A short, human relative-time string ("just now", "5m ago", "3d ago", ...). */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 45) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear}y ago`;
}
