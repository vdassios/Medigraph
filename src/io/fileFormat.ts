import { planProfileMerge } from '../domain/profile';
import { assertProfileSafe, validateProfile } from '../domain/types';
import type { Profile, ProfileMergePlan } from '../domain/types';

/**
 * The `.medigraph` file: a user's whole history, in plaintext UTF-8 JSON.
 *
 * Plaintext is the decision, not a shortcut. A passphrase this product cannot
 * recover would lose a medical history permanently the first time someone
 * forgot it, and encryption at rest buys nothing against the threats that
 * actually apply — a shared device, a lost laptop, an XSS.
 *
 * Two spaces and a trailing newline so a person can open it in any editor and
 * read their own data, and so another implementation can round-trip it without
 * anyone having to agree on canonical JSON.
 *
 * **Every failure is a typed code, never an exception string.** An import is a
 * thing users do to files they were handed, and "something went wrong" is not
 * an answer any of them can act on.
 */

const FORMAT = 'medigraph';

/** The envelope versions this build can read. Migration is by version, not by shape. */
const SUPPORTED_VERSIONS = [1] as const;

/** The version this build writes. */
const CURRENT_VERSION = 1;

/**
 * Ten mebibytes, refused before a byte is parsed.
 *
 * Ten thousand Reports of a thousand Measurements is the validated ceiling and
 * lands far under this, so a file above it is not a history — and because
 * nothing is ever decompressed, there is no bomb to expand behind the check.
 */
const MAX_BYTES = 10 * 1024 * 1024;

export type MedigraphReadError =
  'file-too-large' | 'malformed-json' | 'not-medigraph' | 'unsupported-version' | 'invalid-profile';

export type ImportResult<T> = { ok: true; value: T } | { ok: false; error: MedigraphReadError };

export interface ImportPreview {
  profile: Profile;
  plan: ProfileMergePlan | null;
}

function failed<T>(error: MedigraphReadError): ImportResult<T> {
  return { ok: false, error };
}

/**
 * Write one Profile as a `.medigraph` file.
 *
 * The envelope names the format and its version before the data, so a reader
 * can refuse a file it does not understand without parsing a Profile out of
 * it — and so a file found on a disk years from now identifies itself.
 */
export function serialiseMedigraph(profile: Profile): string {
  return `${JSON.stringify({ format: FORMAT, v: CURRENT_VERSION, profile }, null, 2)}\n`;
}

/** UTF-8, strictly: a byte sequence that is not text is not malformed JSON later. */
function decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Bring a supported envelope up to the current version.
 *
 * There is one version so far and this is the identity, which is the point:
 * the seam exists before it is needed, so the first migration is a case in a
 * switch rather than a redesign of the reader.
 */
function migrate(envelope: Record<string, unknown>, version: number): unknown {
  switch (version) {
    case 1:
      return envelope.profile;
    default:
      return undefined;
  }
}

/**
 * Read a `.medigraph` file into a validated Profile.
 *
 * The order of the checks is the order of the questions: is this file small
 * enough to look at, is it text, is it JSON, is it ours, is it a version we
 * know, and only then — is it a Profile we would be willing to hold. Both
 * gates run: the Zod-backed structural validator, and the separate D7 safety
 * validator over the one free-text path into a Profile, because a structurally
 * perfect Profile can still be unsafe to persist.
 */
export function parseMedigraph(bytes: Uint8Array): ImportResult<Profile> {
  if (bytes.byteLength > MAX_BYTES) {
    return failed('file-too-large');
  }

  const text = decode(bytes);
  if (text === null) {
    return failed('malformed-json');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failed('malformed-json');
  }

  if (!isRecord(parsed) || parsed.format !== FORMAT) {
    return failed('not-medigraph');
  }

  const version = parsed.v;
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.includes(version as 1)) {
    return failed('unsupported-version');
  }

  try {
    const profile = validateProfile(migrate(parsed, version));
    assertProfileSafe(profile);
    return { ok: true, value: profile };
  } catch {
    return failed('invalid-profile');
  }
}

/**
 * Read a file and say what importing it would do — without doing any of it.
 *
 * Nothing here writes, and nothing here chooses. With empty storage there is
 * no plan to make and the screen offers Cancel or Import; with an existing
 * Profile the plan says which Reports are duplicates, which are additions, and
 * which conflicts the user has to answer before Merge can run at all. Import
 * is one of the two irreversible things this product does, so it is previewed
 * in full first.
 */
export function previewImport(
  bytes: Uint8Array,
  existing: Profile | null,
): ImportResult<ImportPreview> {
  const parsed = parseMedigraph(bytes);
  if (!parsed.ok) {
    return failed(parsed.error);
  }

  return {
    ok: true,
    value: {
      profile: parsed.value,
      plan: existing === null ? null : planProfileMerge(existing, parsed.value),
    },
  };
}
