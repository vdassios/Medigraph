import { describe, expect, it } from 'vitest';
import { parseDocumentDate } from './dates';

describe('parseDocumentDate', () => {
  it.each([
    ['03-04-2025', '2025-04-03', 'day-first, never month-first'],
    ['01-01-2020', '2020-01-01', 'the first of January'],
    ['31-12-2024', '2024-12-31', 'the last of December'],
    ['29-02-2024', '2024-02-29', 'a leap day in a leap year'],
    ['29-02-2000', '2000-02-29', 'a leap day in a century leap year'],
    ['28-02-2023', '2023-02-28', 'the last February day of a common year'],
    ['30-04-2025', '2025-04-30', 'the last day of a 30-day month'],
  ])('reads %j as %j — %s', (raw, expected) => {
    expect(parseDocumentDate(raw)).toBe(expected);
  });

  it('is day-first, not month-first', () => {
    // The one reading that matters: a field the repository generated. Were this
    // read month-first it would silently become 4 March and no test would fail
    // on a date where both readings are valid.
    expect(parseDocumentDate('03-04-2025')).toBe('2025-04-03');
    expect(parseDocumentDate('04-03-2025')).toBe('2025-03-04');
  });

  it.each([
    ['31-02-2025', 'a February the calendar does not have'],
    ['29-02-2023', 'a leap day in a common year'],
    ['29-02-1900', 'a leap day in a non-leap century year'],
    ['31-04-2025', 'a 31st in a 30-day month'],
    ['31-06-2025', 'a 31st in June'],
    ['00-01-2025', 'day zero'],
    ['01-00-2025', 'month zero'],
    ['01-13-2025', 'a month above twelve'],
    ['32-01-2025', 'a day above any month'],
  ])('rejects %j — %s', (raw) => {
    expect(parseDocumentDate(raw)).toBeNull();
  });

  it.each([
    ['3-4-2025', 'unpadded day and month'],
    ['03-04-25', 'a two-digit year'],
    ['2025-04-03', 'an ISO date, which is not what the field prints'],
    ['03/04/2025', 'slashes instead of hyphens'],
    ['03-04-2025 10:30', 'a trailing time the field never carries'],
    ['03-04-2025x', 'trailing text'],
    ['x03-04-2025', 'leading text'],
    ['', 'the empty string'],
    ['   ', 'whitespace only'],
    ['Ημερομηνία', 'a label rather than a value'],
  ])('rejects the shape %j — %s', (raw) => {
    expect(parseDocumentDate(raw)).toBeNull();
  });

  it('tolerates surrounding whitespace from a fragmented text layer', () => {
    expect(parseDocumentDate('  03-04-2025  ')).toBe('2025-04-03');
  });

  it('never returns a time', () => {
    // precision:'minute' separates two Reports collected on one day, and that
    // time is the user's in review — the document does not state one.
    expect(parseDocumentDate('03-04-2025')).not.toContain(':');
  });

  it('round-trips every day of a leap February and stops at the boundary', () => {
    for (let day = 1; day <= 29; day += 1) {
      const padded = String(day).padStart(2, '0');
      expect(parseDocumentDate(`${padded}-02-2024`)).toBe(`2024-02-${padded}`);
    }
    expect(parseDocumentDate('30-02-2024')).toBeNull();
  });
});
