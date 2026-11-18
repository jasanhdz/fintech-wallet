import assert from 'node:assert/strict';
import { formatMoney, groupThousands, amountToMinor } from '../src/money';
import { businessDayLabel, businessParts, formatBusinessDateTime, formatUpdatedAt, mexicoCityOffsetMinutes, parseTimestamp } from '../src/dates';

describe('formatMoney (single mobile money formatter)', () => {
  it.each([
    ['0', '$0.00'],
    ['5', '$0.05'],
    ['99', '$0.99'],
    ['100', '$1.00'],
    ['99999', '$999.99'],
    ['1000000', '$10,000.00'],
    ['994000', '$9,940.00'],
    ['505000', '$5,050.00'],
    ['1500000', '$15,000.00'],
    ['9007199254740993', '$90,071,992,547,409.93'], // > 2^53: exact, no Number rounding
    ['922337203685477580700', '$9,223,372,036,854,775,807.00'],
    ['-5', '-$0.05'],
    ['-123456789', '-$1,234,567.89'],
  ])('%s -> %s', (minor, expected) => {
    assert.equal(formatMoney(minor), expected);
  });

  it('adds direction signs and the currency exactly once', () => {
    assert.equal(formatMoney('85000', { sign: 'debit', currency: true }), '-$850.00 MXN');
    assert.equal(formatMoney('1000000', { sign: 'credit' }), '+$10,000.00');
    assert.equal(formatMoney(12345n, { currency: true }), '$123.45 MXN');
  });

  it('never formats invalid input as a number', () => {
    for (const value of ['', 'abc', '1.5', '01', undefined, null, '1e5']) assert.equal(formatMoney(value as string), '—');
  });

  it('does not depend on toLocaleString/Intl grouping (Hermes may not group BigInt)', () => {
    const original = BigInt.prototype.toLocaleString;
    BigInt.prototype.toLocaleString = function toLocaleString(this: bigint) { return this.toString(); };
    try { assert.equal(formatMoney('994000'), '$9,940.00'); } finally {
      BigInt.prototype.toLocaleString = original;
    }
  });

  it('groups digit strings', () => {
    assert.equal(groupThousands('1'), '1');
    assert.equal(groupThousands('1234'), '1,234');
    assert.equal(groupThousands('123456'), '123,456');
  });

  it('parses typed amounts exactly', () => {
    assert.equal(amountToMinor('850'), '85000');
    assert.equal(amountToMinor('0.05'), '5');
    assert.equal(amountToMinor('1.234'), null);
    assert.equal(amountToMinor('0'), null);
  });
});

/** Mimics the Hermes Intl seen on the device: zone reported as honoured, but formatToParts types/values unusable. */
function hermesLikeIntl(parts: Array<{ type: string; value: string }>) {
  class FakeDateTimeFormat {
    resolvedOptions() { return { timeZone: 'America/Mexico_City' }; }
    formatToParts() { return parts; }
  }
  return { DateTimeFormat: FakeDateTimeFormat as unknown as typeof Intl.DateTimeFormat };
}

describe('business date formatting (America/Mexico_City)', () => {
  const iso = '2026-11-13T20:32:00.123Z';

  it('formats contract timestamps in business time', () => {
    assert.equal(formatBusinessDateTime(iso), '13 de noviembre de 2026, 14:32 hrs');
    assert.equal(formatBusinessDateTime('2026-11-14T05:59:00.000Z'), '13 de noviembre de 2026, 23:59 hrs');
    assert.equal(formatBusinessDateTime('2026-11-14T06:01:00.000Z'), '14 de noviembre de 2026, 00:01 hrs');
  });

  it('rejects unusable Intl parts and falls back to the deterministic offset table', () => {
    const broken = [
      hermesLikeIntl([{ type: 'day', value: 'a' }, { type: 'year', value: '8' }]),
      hermesLikeIntl([{ type: 'literal', value: '13/11/2026 14:32' }]),
      hermesLikeIntl([{ type: 'day', value: '13' }, { type: 'month', value: 'noviembre' }, { type: 'year', value: '2026' }, { type: 'hour', value: '14' }, { type: 'minute', value: '32' }]),
      hermesLikeIntl([{ type: 'day', value: '31' }, { type: 'month', value: '02' }, { type: 'year', value: '2026' }, { type: 'hour', value: '14' }, { type: 'minute', value: '32' }]),
    ];
    for (const intl of broken) {
      const text = formatBusinessDateTime(iso, intl);
      assert.equal(text, '13 de noviembre de 2026, 14:32 hrs');
      assert.doesNotMatch(String(text), /undefined|NaN|Invalid/);
    }
  });

  it('uses the table when Intl throws or does not support the zone', () => {
    const throwing = { DateTimeFormat: function Throwing() { throw new RangeError('Unsupported time zone'); } as unknown as typeof Intl.DateTimeFormat };
    assert.equal(formatBusinessDateTime(iso, throwing), '13 de noviembre de 2026, 14:32 hrs');
    class Utc { resolvedOptions() { return { timeZone: 'UTC' }; } formatToParts() { return []; } }
    assert.equal(formatBusinessDateTime(iso, { DateTimeFormat: Utc as unknown as typeof Intl.DateTimeFormat }), '13 de noviembre de 2026, 14:32 hrs');
  });

  it('returns null for missing or invalid timestamps (screens show "Fecha no disponible")', () => {
    for (const value of [undefined, null, '', 'ayer', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', '2026-11-13 20:32']) {
      assert.equal(formatBusinessDateTime(value), null);
      assert.equal(businessParts(value), null);
    }
    assert.equal(businessDayLabel('nope'), 'Fecha no disponible');
  });

  it('parses 6-decimal and offset timestamps exactly', () => {
    assert.equal(parseTimestamp('2026-11-13T20:32:00.123456Z'), Date.UTC(2026, 10, 13, 20, 32, 0, 123));
    assert.equal(parseTimestamp('2026-11-13T14:32:00-06:00'), Date.UTC(2026, 10, 13, 20, 32));
  });

  it('applies historical daylight time before 2022-10-30 and UTC-6 afterwards', () => {
    assert.equal(mexicoCityOffsetMinutes(Date.UTC(2021, 6, 1)), -300);
    assert.equal(mexicoCityOffsetMinutes(Date.UTC(2021, 0, 1)), -360);
    assert.equal(mexicoCityOffsetMinutes(Date.UTC(2022, 9, 30, 6, 59)), -300);
    assert.equal(mexicoCityOffsetMinutes(Date.UTC(2022, 9, 30, 7, 0)), -360);
    assert.equal(mexicoCityOffsetMinutes(Date.UTC(2026, 6, 1)), -360);
  });

  it('labels movement days relative to the business day, not the device day', () => {
    const now = Date.UTC(2026, 10, 14, 3, 0); // 13 nov 21:00 in Mexico City, already 14 nov in UTC
    assert.equal(businessDayLabel('2026-11-13T18:00:00.000Z', now), 'Hoy (13 nov 2026)');
    assert.equal(businessDayLabel('2026-11-12T18:00:00.000Z', now), 'Ayer (12 nov 2026)');
    assert.equal(businessDayLabel('2026-11-10T18:00:00.000Z', now), '10 de noviembre 2026');
    assert.equal(formatUpdatedAt(Date.UTC(2026, 10, 13, 20, 32), now), 'Actualizado hoy, 14:32 hrs');
  });
});
