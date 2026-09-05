import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Measurement, Profile, Report } from '../domain/types';
import { parseMedigraph, previewImport, serialiseMedigraph } from './fileFormat';

const GOLDEN = new URL('../../fixtures/file-format/v1.medigraph', import.meta.url);

function golden(): Uint8Array {
  return new Uint8Array(readFileSync(GOLDEN));
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The Profile the committed file holds, read back through the parser. */
function imported(): Profile {
  const parsed = parseMedigraph(golden());
  if (!parsed.ok) {
    throw new Error(`the committed fixture no longer parses: ${parsed.error}`);
  }
  return parsed.value;
}

function envelope(value: unknown): Uint8Array {
  return bytes(JSON.stringify(value));
}

function measurement(markerKey: string, overrides: Partial<Measurement> = {}): Measurement {
  return {
    markerKey,
    status: 'value',
    value: 1,
    comparator: null,
    textValue: null,
    unit: 'mg/dL',
    referenceRange: null,
    categoricalReference: null,
    sourceOrder: 0,
    ...overrides,
  };
}

function report(id: string, date: string, time: string | null = null): Report {
  return {
    id,
    collectedAt:
      time === null ? { date, time: null, precision: 'day' } : { date, time, precision: 'minute' },
    measurements: [measurement('glucose')],
  };
}

function profile(reports: Report[], id = 'profile-1'): Profile {
  return { schemaVersion: 1, id, reports };
}

/** A file carrying an arbitrary profile body, valid envelope. */
function fileOf(profileBody: unknown): Uint8Array {
  return envelope({ format: 'medigraph', v: 1, profile: profileBody });
}

describe('serialiseMedigraph', () => {
  it('writes the committed file byte for byte', () => {
    // The format is a promise to the user and to any other implementation.
    // Comparing bytes is the only check that catches a key order, an
    // indentation or a trailing newline drifting.
    expect(serialiseMedigraph(imported())).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('names the format and its version before the data', () => {
    // A file found on a disk years from now has to identify itself, and a
    // reader has to be able to refuse it without parsing a Profile out of it.
    const written = serialiseMedigraph(profile([report('r1', '2025-05-14')]));

    expect(written.startsWith('{\n  "format": "medigraph",\n  "v": 1,\n')).toBe(true);
  });

  it('pretty-prints with two spaces and ends with one newline', () => {
    const written = serialiseMedigraph(profile([]));

    expect(written.endsWith('}\n')).toBe(true);
    expect(written.endsWith('}\n\n')).toBe(false);
    expect(written).toContain('\n  "profile": {');
  });

  it('is plaintext: no compression, no cipher, no framing', () => {
    // The dialog tells the user this file is not encrypted. That has to stay
    // true by construction, not by anyone remembering.
    const written = serialiseMedigraph(imported());

    expect(written).toContain('"markerKey": "wbc"');
    expect(JSON.parse(written)).toMatchObject({ format: 'medigraph', v: 1 });
  });

  it('round-trips a Profile unchanged', () => {
    const source = imported();
    const again = parseMedigraph(bytes(serialiseMedigraph(source)));

    expect(again.ok && again.value).toEqual(source);
  });
});

describe('parseMedigraph', () => {
  it('reads the committed file', () => {
    const parsed = parseMedigraph(golden());

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.reports).toHaveLength(2);
  });

  it('keeps every field the file carried', () => {
    const [, second] = imported().reports;

    expect(second?.measurements).toEqual([
      expect.objectContaining({ markerKey: 'crp', value: 1.03, comparator: '<' }),
      expect.objectContaining({ markerKey: 'urine-glucose', textValue: 'Αρνητικό' }),
      expect.objectContaining({ markerKey: 'x:νεοδεικτησ-nd', label: 'Νεοδείκτης (ND)' }),
    ]);
  });

  describe('files it refuses', () => {
    it('refuses a file over ten mebibytes before parsing it', () => {
      // Nothing is ever decompressed, so there is no bomb behind this check —
      // it is a cap on what is worth looking at.
      expect(parseMedigraph(new Uint8Array(10 * 1024 * 1024 + 1))).toEqual({
        ok: false,
        error: 'file-too-large',
      });
    });

    it('accepts a file of exactly ten mebibytes', () => {
      // At the bound the answer must be about the content, not the size.
      const padded = new Uint8Array(10 * 1024 * 1024);
      padded.set(bytes('not json'));

      expect(parseMedigraph(padded)).toEqual({ ok: false, error: 'malformed-json' });
    });

    it('refuses bytes that are not UTF-8', () => {
      expect(parseMedigraph(new Uint8Array([0xff, 0xfe, 0xfd]))).toEqual({
        ok: false,
        error: 'malformed-json',
      });
    });

    it('refuses text that is not JSON', () => {
      expect(parseMedigraph(bytes('{ "format": '))).toEqual({
        ok: false,
        error: 'malformed-json',
      });
    });

    it.each([
      ['a JSON array', envelope([])],
      ['a bare number', envelope(7)],
      ['another product’s envelope', envelope({ format: 'healthvault', v: 1, profile: {} })],
      ['a missing marker', envelope({ v: 1, profile: {} })],
    ])('refuses %s as not ours', (_name, file) => {
      expect(parseMedigraph(file)).toEqual({ ok: false, error: 'not-medigraph' });
    });

    it.each([
      ['a future version', envelope({ format: 'medigraph', v: 2, profile: {} })],
      ['a version that is not a number', envelope({ format: 'medigraph', v: '1', profile: {} })],
      ['no version at all', envelope({ format: 'medigraph', profile: {} })],
    ])('refuses %s', (_name, file) => {
      expect(parseMedigraph(file)).toEqual({ ok: false, error: 'unsupported-version' });
    });

    it('refuses an envelope with no Profile in it', () => {
      expect(parseMedigraph(envelope({ format: 'medigraph', v: 1 }))).toEqual({
        ok: false,
        error: 'invalid-profile',
      });
    });
  });

  describe('Profiles it refuses', () => {
    it('refuses a Report repeating a marker key', () => {
      const broken = profile([
        {
          ...report('r1', '2025-05-14'),
          measurements: [measurement('glucose'), measurement('glucose')],
        },
      ]);

      expect(parseMedigraph(fileOf(broken))).toEqual({ ok: false, error: 'invalid-profile' });
    });

    it('refuses two Reports on one date unless both name a distinct minute', () => {
      const clashing = profile([report('r1', '2025-05-14'), report('r2', '2025-05-14')]);
      const timed = profile([
        report('r1', '2025-05-14', '09:30'),
        report('r2', '2025-05-14', '18:05'),
      ]);

      expect(parseMedigraph(fileOf(clashing))).toEqual({ ok: false, error: 'invalid-profile' });
      expect(parseMedigraph(fileOf(timed)).ok).toBe(true);
    });

    it('refuses a date the calendar does not have', () => {
      expect(parseMedigraph(fileOf(profile([report('r1', '2025-02-31')])))).toEqual({
        ok: false,
        error: 'invalid-profile',
      });
    });

    it('refuses a Report above the measurement cap', () => {
      const crowded = profile([
        {
          ...report('r1', '2025-05-14'),
          measurements: Array.from({ length: 1001 }, (_unused, index) =>
            measurement(`x:m${String(index)}`, { label: `m${String(index)}` }),
          ),
        },
      ]);

      expect(parseMedigraph(fileOf(crowded))).toEqual({ ok: false, error: 'invalid-profile' });
    });

    it.each([
      ['a label on a canonical marker', measurement('glucose', { label: 'Γλυκόζη' })],
      ['a label carrying an AMKA', measurement('x:one', { label: 'Ασθενής 01018099901' })],
      [
        'a label carrying an email address',
        measurement('x:one', { label: 'γιατρός nikos@example.gr' }),
      ],
      ['a label over 120 characters', measurement('x:one', { label: 'Δ'.repeat(121) })],
    ])('refuses %s (D7)', (_name, bad) => {
      // The one path source text can take into a Profile is a label the user
      // approved, so it gets a safety gate independent of the schema: a
      // structurally perfect Profile can still be unsafe to hold.
      const unsafe = profile([{ ...report('r1', '2025-05-14'), measurements: [bad] }]);

      expect(parseMedigraph(fileOf(unsafe))).toEqual({ ok: false, error: 'invalid-profile' });
    });

    it('refuses a label carrying a newline', () => {
      const smuggled = profile([
        {
          ...report('r1', '2025-05-14'),
          measurements: [measurement('x:one', { label: 'Δείκτης\nΠΑΠΑΔΟΠΟΥΛΟΣ' })],
        },
      ]);

      expect(parseMedigraph(fileOf(smuggled))).toEqual({ ok: false, error: 'invalid-profile' });
    });
  });
});

describe('previewImport', () => {
  it('offers the imported Profile and no plan when storage is empty', () => {
    const preview = previewImport(golden(), null);

    expect(preview.ok).toBe(true);
    expect(preview.ok && preview.value.plan).toBeNull();
    expect(preview.ok && preview.value.profile.reports).toHaveLength(2);
  });

  it('plans an id-based merge against an existing Profile', () => {
    const existing = profile([report('r1', '2025-01-10')]);
    const preview = previewImport(fileOf(profile([report('r2', '2025-03-04')])), existing);

    expect(preview.ok && preview.value.plan).toMatchObject({
      duplicateReportIds: [],
      conflicts: [],
    });
    expect(preview.ok && preview.value.plan?.additions.map((each) => each.id)).toEqual(['r2']);
  });

  it('reports a Report that arrives identical as a duplicate', () => {
    const existing = profile([report('r1', '2025-01-10')]);
    const preview = previewImport(fileOf(profile([report('r1', '2025-01-10')])), existing);

    expect(preview.ok && preview.value.plan?.duplicateReportIds).toEqual(['r1']);
  });

  it('exposes a same-id different-content conflict', () => {
    const existing = profile([report('r1', '2025-01-10')]);
    const changed = {
      ...report('r1', '2025-01-10'),
      measurements: [measurement('glucose', { value: 99 })],
    };
    const preview = previewImport(fileOf(profile([changed])), existing);

    expect(preview.ok && preview.value.plan?.conflicts.map((each) => each.kind)).toEqual([
      'report-id',
    ]);
  });

  it('exposes a same-day precision conflict', () => {
    const existing = profile([report('r1', '2025-05-14')]);
    const preview = previewImport(fileOf(profile([report('r2', '2025-05-14')])), existing);

    expect(preview.ok && preview.value.plan?.conflicts.map((each) => each.kind)).toEqual([
      'same-day-precision',
    ]);
  });

  it('never merges two Reports because they share a date', () => {
    const existing = profile([report('r1', '2025-05-14', '09:30')]);
    const preview = previewImport(fileOf(profile([report('r2', '2025-05-14', '18:05')])), existing);

    expect(preview.ok && preview.value.plan?.duplicateReportIds).toEqual([]);
    expect(preview.ok && preview.value.plan?.additions).toHaveLength(1);
  });

  it('writes nothing and changes nothing', () => {
    // Import is one of the two irreversible things this product does, so it is
    // previewed in full before any of it happens.
    const existing = profile([report('r1', '2025-01-10')]);
    const before = structuredClone(existing);

    previewImport(golden(), existing);

    expect(existing).toEqual(before);
  });

  it('passes a read failure through unchanged', () => {
    expect(previewImport(bytes('not json'), null)).toEqual({
      ok: false,
      error: 'malformed-json',
    });
    expect(previewImport(new Uint8Array(10 * 1024 * 1024 + 1), null)).toEqual({
      ok: false,
      error: 'file-too-large',
    });
  });
});
