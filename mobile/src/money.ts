// Single money formatter for the mobile app. Amounts arrive from the API as minor-unit decimal strings and are
// formatted with BigInt only: never Number, never toLocaleString/Intl (Hermes may not group thousands for BigInt).

const MINOR_PATTERN = /^-?(?:0|[1-9]\d*)$/;

export type MoneySign = 'auto' | 'debit' | 'credit';

/** Groups an unsigned integer string with commas every three digits ("1234567" -> "1,234,567"). */
export function groupThousands(digits: string): string {
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ',';
    out += digits[index];
  }
  return out;
}

/** True when the value is an integer minor-unit string (optionally negative) that can be formatted exactly. */
export function isMinorUnits(value: unknown): value is string {
  return typeof value === 'string' && MINOR_PATTERN.test(value);
}

/**
 * "$1,234.56" from "123456". `sign: 'debit'` prefixes "-" and `'credit'` "+" (for movement direction); `'auto'`
 * only shows "-" for negative values. `currency: true` appends " MXN" exactly once. Invalid input renders "—".
 */
export function formatMoney(minor: string | bigint | null | undefined, options: { sign?: MoneySign; currency?: boolean } = {}): string {
  let value: bigint;
  if (typeof minor === 'bigint') value = minor;
  else if (isMinorUnits(minor)) value = BigInt(minor);
  else return '—';
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = groupThousands((absolute / 100n).toString());
  const cents = (absolute % 100n).toString().padStart(2, '0');
  const sign = options.sign ?? 'auto';
  const prefix = negative || sign === 'debit' ? '-' : sign === 'credit' ? '+' : '';
  return `${prefix}$${whole}.${cents}${options.currency ? ' MXN' : ''}`;
}

/** Exact parse of a user-typed MXN amount ("1,5" is rejected; max two decimals) into minor units, or null. */
export function amountToMinor(value: string): string | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = '', fraction = ''] = normalized.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+/, '');
  return minor && /[1-9]/.test(minor) ? minor : null;
}
