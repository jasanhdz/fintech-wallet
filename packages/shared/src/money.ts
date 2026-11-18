const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

/** Parse a positive MXN decimal string exactly into minor units. Never passes through Number. */
export function parseMxnToMinor(input: string): string {
  const value = input.trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) throw new Error('Importe MXN inválido; usa como máximo dos decimales.');

  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  const minor = whole * 100n + fraction;
  if (minor <= 0n) throw new Error('El importe debe ser mayor que cero.');
  if (minor > POSTGRES_BIGINT_MAX) throw new Error('El importe excede el máximo soportado.');
  return minor.toString();
}

/** Format signed minor units without floating-point arithmetic. */
export function formatMxnFromMinor(input: string, locale = 'es-MX'): string {
  if (!/^-?(0|[1-9][0-9]*)$/.test(input)) throw new Error('Importe minor-unit inválido.');
  const amount = BigInt(input);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
  return `${negative ? '-' : ''}$${grouped}.${cents} MXN`;
}

export function addMinorUnits(left: string, right: string): string {
  if (!/^-?(0|[1-9][0-9]*)$/.test(left) || !/^-?(0|[1-9][0-9]*)$/.test(right)) {
    throw new Error('Importe minor-unit inválido.');
  }
  return (BigInt(left) + BigInt(right)).toString();
}
