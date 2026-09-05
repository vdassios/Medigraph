import type { TextItem } from '../domain/types';

/**
 * The extraction seam (D4, D1a).
 *
 * Everything downstream of `ExtractionResult` is extraction-agnostic:
 * replacing the adapter changes `io/`, not review and not the domain. The seam
 * survives ADR-0013 with exactly one implementation behind it, because the
 * input class being closed is what makes the simplification safe — reopening it
 * means reopening the ADR, not rewriting review.
 *
 * **Rules this file exists to keep.** No module outside `io/` may import
 * `pdfjs-dist`, and no vendor object may cross this boundary: what leaves is
 * `TextItem[][]`, plain data the domain could have been handed by anything. A
 * builder that reaches through the seam has broken D1a even if the tests pass.
 */

export interface AdapterOutput {
  kind: 'textItems';
  pages: TextItem[][];
}

export interface ExtractionAdapter {
  readonly id: string; // 'pdf-text' | …
  readonly tier: 'E0';
  supports(file: File): boolean;
  extract(file: File, sourceId: string, signal: AbortSignal): Promise<AdapterOutput>;
}

/**
 * Fetch one runtime asset this app serves itself.
 *
 * Every browser byte is first-party (D1, ADR-0015): the pdf.js worker ships
 * inside the pinned package and is copied under `public/`, never pulled from a
 * CDN at runtime. The CSP says the same thing in the one place a browser
 * enforces it — `connect-src 'self'` — so a path that ever pointed off-origin
 * would fail loudly rather than quietly succeeding.
 *
 * The path is required to be root-relative for that reason: it is the one
 * argument that could smuggle an origin in.
 */
export async function loadRuntimeAsset(path: string, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`runtime-asset-not-first-party: ${path}`);
  }

  const response = await fetch(path, { signal, credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`runtime-asset-unavailable: ${path} (${String(response.status)})`);
  }

  return response.arrayBuffer();
}
