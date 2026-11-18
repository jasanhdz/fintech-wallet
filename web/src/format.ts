// Presentation helpers shared by W03/W04/W05 (SPEC §5.9 D-3, D-4). Amounts stay strings/BigInt end to end:
// `formatMxnFromMinor` (shared) does the exact formatting; nothing here converts money to Number.
import { formatMxnFromMinor } from '@fintech-wallet/shared';

/** D-3: split a minor-unit amount into sign, number and the single «MXN» suffix (painted one step smaller). */
export function splitMxn(minor: string, sign: '' | '+' | '−' = '') {
  const formatted = formatMxnFromMinor(minor.replace(/^-/, ''));
  return { sign, number: formatted.replace(/ MXN$/, ''), suffix: 'MXN' as const };
}

/** Signed amount text for a movement: «−$12.30 MXN» (debit) / «+$4.50 MXN» (credit). */
export function signedMxn(type: 'debit' | 'credit', minor: string) {
  return `${type === 'debit' ? '−' : '+'}${formatMxnFromMinor(minor)}`;
}

/** Browser zone, used only until GET /transfer-policy answers with `businessTimeZone` (D-4). */
export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function zoned(timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  try { return new Intl.DateTimeFormat('es-MX', { ...options, timeZone: timeZone || undefined }); } catch { return new Intl.DateTimeFormat('es-MX', options); }
}

const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase('es-MX') + value.slice(1);

/** «Martes, 17 de noviembre de 2026» in the business zone (no «CST» suffix, D-4). */
export function longDate(instant: Date, timeZone?: string) {
  return capitalize(zoned(timeZone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(instant));
}

/** «Martes, 17 de noviembre de 2026» for a calendar day `YYYY-MM-DD` (the policy's `businessDate`). */
export function longBusinessDate(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const noon = new Date(Date.UTC(Number.parseInt(match[1]!, 10), Number.parseInt(match[2]!, 10) - 1, Number.parseInt(match[3]!, 10), 12));
  return longDate(noon, 'UTC');
}

/** «17 de noviembre de 2026, 14:32» (W03 activity, W05 detail). */
export function longDateTime(iso: string, timeZone?: string) {
  const instant = new Date(iso);
  const date = zoned(timeZone, { day: 'numeric', month: 'long', year: 'numeric' }).format(instant);
  const time = zoned(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
  return `${date}, ${time}`;
}

/** W04 date column: `{ date: '17/11/2026', time: '14:32' }`. */
export function shortDateTime(iso: string, timeZone?: string) {
  const instant = new Date(iso);
  return {
    date: zoned(timeZone, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(instant),
    time: zoned(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant),
  };
}

/** Offset (ms) of `timeZone` at `instant`: local wall-clock time read as UTC minus the instant. */
function zoneOffset(instant: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number.parseInt(part.value, 10)]));
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!, parts.second!);
  return wall - (instant - (instant % 1000));
}

/** UTC instant of 00:00 of business day `YYYY-MM-DD` in `timeZone` (D-4, Intl only, DST-safe). */
export function businessDayStart(day: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error('Fecha inválida.');
  const guess = Date.UTC(Number.parseInt(match[1]!, 10), Number.parseInt(match[2]!, 10) - 1, Number.parseInt(match[3]!, 10));
  let result = guess - zoneOffset(guess, timeZone);
  const corrected = guess - zoneOffset(result, timeZone);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

/** `YYYY-MM-DD` of the day after `day` (calendar arithmetic in UTC, independent of zones). */
export function nextDay(day: string) {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10));
  const next = new Date(Date.UTC(year!, month! - 1, date! + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * W04 filter bounds `[00:00 of from, 24:00 of to)` in the business zone. The API filter is inclusive on both
 * ends (`completed_at <= to`), so the upper bound is sent as 24:00 minus one millisecond.
 */
export function businessRange(from: string, to: string, timeZone: string) {
  return {
    ...(from ? { from: businessDayStart(from, timeZone).toISOString() } : {}),
    ...(to ? { to: new Date(businessDayStart(nextDay(to), timeZone).getTime() - 1).toISOString() } : {}),
  };
}
