/**
 * Calendar-date helpers. All "local dates" are ISO strings `YYYY-MM-DD` that represent a
 * calendar day in the user's own time zone. Arithmetic is done on UTC epoch days so that
 * DST transitions never shift a day.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export type LocalDate = string;

export function isValidLocalDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function assertLocalDate(value: string): LocalDate {
  if (!isValidLocalDate(value)) throw new RangeError(`Invalid calendar date: ${value}`);
  return value;
}

/** Days since 1970-01-01 for a local calendar date. */
export function toEpochDay(date: LocalDate): number {
  assertLocalDate(date);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromEpochDay(day: number): LocalDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date of an instant as seen in an IANA time zone. */
export function localDateInTimeZone(instant: Date, timeZone: string): LocalDate {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid instant');
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Invalid time zone: ${timeZone}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * UTC instant of a wall-clock `HH:MM` on a calendar date in an IANA zone.
 * A time inside a DST gap resolves to the instant just after the gap.
 */
export function zonedTimeToUtc(date: LocalDate, time: string, timeZone: string): Date {
  assertLocalDate(date);
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new RangeError(`Invalid time: ${time}`);
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Invalid time zone: ${timeZone}`);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
  const o1 = zoneOffsetMs(guess, timeZone);
  let t = guess - o1;
  const o2 = zoneOffsetMs(t, timeZone);
  if (o2 !== o1) t = guess - o2;
  return new Date(t);
}

/** Local `HH:MM` of an instant in an IANA zone. */
export function localTimeInTimeZone(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}
