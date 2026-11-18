// Business-time date formatting for the mobile app. Every screen (M02, M03, M04, M10) uses these helpers so a
// timestamp reads the same everywhere. Intl output is validated part by part (Hermes' Intl may return parts with
// unexpected types or values); when Intl cannot honour the zone, a deterministic offset table for
// America/Mexico_City is used instead. Nothing here reads the device time zone.

export const BUSINESS_TIME_ZONE = 'America/Mexico_City';
export const BUSINESS_ZONE_LABEL = 'Tiempo del Centro de México';
export const DATE_UNAVAILABLE = 'Fecha no disponible';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

export type BusinessParts = { year: number; month: number; day: number; hour: number; minute: number };
type IntlLike = { DateTimeFormat: typeof Intl.DateTimeFormat };

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch milliseconds of an RFC 3339 timestamp (parsed by hand, not by Date.parse), or null if invalid. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== 'string') return null;
  const match = ISO_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '0', fraction = '', zone = 'Z'] = match;
  const year = Number(y), month = Number(mo), day = Number(d), hour = Number(h), minute = Number(mi), second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return null;
  const millis = Number(fraction.padEnd(3, '0').slice(0, 3));
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** UTC epoch ms of the n-th (1-based, or -1 = last) Sunday of a month at the given UTC hour. */
function sundayUtc(year: number, month: number, nth: number, utcHour: number): number {
  if (nth > 0) {
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((7 - firstDow) % 7) + (nth - 1) * 7;
    return Date.UTC(year, month - 1, day, utcHour);
  }
  const last = daysInMonth(year, month);
  const lastDow = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  return Date.UTC(year, month - 1, last - lastDow, utcHour);
}

/**
 * UTC offset of America/Mexico_City in minutes. Since 2022-10-30 the zone is UTC-6 all year. From 1996 to 2022
 * daylight time (UTC-5) ran from the first Sunday of April 02:00 local to the last Sunday of October 02:00 local.
 * Earlier instants use UTC-6 (outside any data this app shows).
 */
export function mexicoCityOffsetMinutes(epochMs: number): number {
  const year = new Date(epochMs).getUTCFullYear();
  if (year < 1996 || year > 2022) return -360;
  const start = sundayUtc(year, 4, 1, 8); // 02:00 CST = 08:00 UTC
  const end = sundayUtc(year, 10, -1, 7); // 02:00 CDT = 07:00 UTC
  return epochMs >= start && epochMs < end ? -300 : -360;
}

function partsFromOffset(epochMs: number): BusinessParts {
  const local = new Date(epochMs + mexicoCityOffsetMinutes(epochMs) * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

function validParts(parts: Partial<Record<string, string>>): BusinessParts | null {
  const read = (key: string, min: number, max: number, digits: RegExp) => {
    const raw = parts[key];
    if (typeof raw !== 'string' || !digits.test(raw)) return null;
    const value = Number(raw);
    return value >= min && value <= max ? value : null;
  };
  const year = read('year', 1000, 9999, /^\d{4}$/);
  const month = read('month', 1, 12, /^\d{1,2}$/);
  const day = read('day', 1, 31, /^\d{1,2}$/);
  let hour = read('hour', 0, 24, /^\d{1,2}$/);
  const minute = read('minute', 0, 59, /^\d{1,2}$/);
  if (year === null || month === null || day === null || hour === null || minute === null) return null;
  if (day > daysInMonth(year, month)) return null;
  if (hour === 24) hour = 0; // some engines render midnight as 24 even with hourCycle h23
  return { year, month, day, hour, minute };
}

/** Calendar parts of an instant in the business zone; Intl is used only if every part validates. */
export function businessParts(value: unknown, intl: IntlLike | undefined = globalThis.Intl): BusinessParts | null {
  const epochMs = parseTimestamp(value);
  if (epochMs === null) return null;
  try {
    if (intl?.DateTimeFormat) {
      const formatter = new intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      if (formatter.resolvedOptions().timeZone === BUSINESS_TIME_ZONE && typeof formatter.formatToParts === 'function') {
        const raw: Record<string, string> = {};
        for (const part of formatter.formatToParts(new Date(epochMs))) if (part && typeof part.type === 'string') raw[part.type] = String(part.value);
        const parts = validParts(raw);
        if (parts) return parts;
      }
    }
  } catch { /* fall through to the deterministic table */ }
  return partsFromOffset(epochMs);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "13 de noviembre de 2026, 14:32 hrs" in business time, or null when the timestamp is missing/invalid. */
export function formatBusinessDateTime(value: unknown, intl?: IntlLike): string | null {
  const parts = businessParts(value, intl ?? globalThis.Intl);
  if (!parts) return null;
  return `${parts.day} de ${MONTHS[parts.month - 1]} de ${parts.year}, ${pad(parts.hour)}:${pad(parts.minute)} hrs`;
}

/** "14:32" in business time, or null. */
export function formatBusinessTime(value: unknown): string | null {
  const parts = businessParts(value);
  return parts ? `${pad(parts.hour)}:${pad(parts.minute)}` : null;
}

/** "13 nov, 14:32" in business time, or null. */
export function formatBusinessShort(value: unknown): string | null {
  const parts = businessParts(value);
  return parts ? `${parts.day} ${MONTHS_SHORT[parts.month - 1]}, ${pad(parts.hour)}:${pad(parts.minute)}` : null;
}

/** Stable "YYYY-MM-DD" key of the business day, or null. */
export function businessDayKey(value: unknown): string | null {
  const parts = businessParts(value);
  return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : null;
}

/** Day heading for movement groups: "Hoy (13 nov 2026)", "Ayer (12 nov 2026)" or "10 de noviembre 2026". */
export function businessDayLabel(value: unknown, now: unknown = Date.now()): string {
  const parts = businessParts(value);
  const today = businessParts(now);
  if (!parts || !today) return DATE_UNAVAILABLE;
  const days = Math.round((Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(parts.year, parts.month - 1, parts.day)) / 86_400_000);
  const short = `${parts.day} ${MONTHS_SHORT[parts.month - 1]} ${parts.year}`;
  if (days === 0) return `Hoy (${short})`;
  if (days === 1) return `Ayer (${short})`;
  return `${parts.day} de ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** "Actualizado hoy, 14:32 hrs" / "Actualizado 12 nov, 09:05 hrs" for a fetch time, in business time. */
export function formatUpdatedAt(timestamp: number, now: number = Date.now()): string | null {
  const parts = businessParts(timestamp);
  if (!parts) return null;
  const sameDay = businessDayKey(timestamp) === businessDayKey(now);
  return `Actualizado ${sameDay ? 'hoy' : `${parts.day} ${MONTHS_SHORT[parts.month - 1]}`}, ${pad(parts.hour)}:${pad(parts.minute)} hrs`;
}
