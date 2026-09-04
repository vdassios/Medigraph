import type { Row, TextItem } from './types';

/**
 * Vertical clustering: TextItems to Rows, shared by Pass V and Pass A.
 *
 * This is the one place the ΑΗΦΥ table is not naively rectangular. A label too
 * long for its cell wraps, and the laboratory centres the single-line value
 * against the two-line label — so the value band sits *between* the label's
 * two lines rather than beside either:
 *
 * ```text
 *   Μέσος Όγκος Ερυθρών (ΜCV)
 *                              90.4   fl   77 - 100
 *   (MCV)
 * ```
 *
 * All three bands are one row. Clustering by band overlap alone would not say
 * so, and reading each printed line as a row would strand the value from half
 * its label.
 */

/**
 * Two items share a row when their vertical centres differ by less than 0.6×
 * the smaller height.
 *
 * Centres rather than edges, because a tall item — a title, a superscript's
 * neighbour — overlaps bands it does not belong to. The 0.6 factor is measured,
 * not chosen: in the seed corpus a wrapped label sits 0.0065 from its value
 * band and consecutive rows sit 0.020 apart, against a 0.0141 line height. The
 * threshold of 0.0085 separates those two populations with room on both sides.
 */
function sharesRow(a: TextItem, b: TextItem): boolean {
  const centres = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2));
  return centres < 0.6 * Math.min(a.h, b.h);
}

/** A cluster always holds the item that started it. */
type Cluster = [TextItem, ...TextItem[]];

/**
 * The band every item in a cluster spans.
 *
 * One item is its own band. Recomputing `h` as `bottom - top` would return a
 * height a floating-point hair different from the one the adapter measured.
 */
function band(cluster: Cluster): { y: number; h: number } {
  const [first] = cluster;

  if (cluster.length === 1) {
    return { y: first.y, h: first.h };
  }

  let top = first.y;
  let bottom = first.y + first.h;

  for (const item of cluster) {
    top = Math.min(top, item.y);
    bottom = Math.max(bottom, item.y + item.h);
  }

  return { y: top, h: bottom - top };
}

/**
 * Cluster one page, sweeping top to bottom.
 *
 * An item joins the open cluster when it shares a row with **any** item
 * already in it, not merely with the item that opened it. That transitivity is
 * what carries the wrapped label: its second line is two bands below the
 * first, further than the threshold allows, and reaches the row only through
 * the value band sitting between them.
 */
function clustersOf(items: readonly TextItem[]): Cluster[] {
  const [head, ...rest] = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  if (head === undefined) {
    return [];
  }

  const clusters: Cluster[] = [];
  let open: Cluster = [head];

  for (const item of rest) {
    if (open.some((member) => sharesRow(member, item))) {
      open.push(item);
      continue;
    }

    clusters.push(open);
    open = [item];
  }

  clusters.push(open);
  return clusters;
}

/**
 * Every page's Rows, ordered top to bottom, each holding its items left to
 * right.
 *
 * The items are the adapter's own observations, neither copied nor adjusted:
 * every downstream box, offset and crop is measured against what pdf.js
 * reported (D13).
 *
 * **Left to right is the row's order, not its label's.** A wrapped label's two
 * lines start at the same x, so ordering by x interleaves them with the cells
 * between. Reassembling that label is the job of a caller that knows the
 * column roles Pass V bound — it selects the label column and reads it top to
 * bottom. This function has no column model and invents none.
 */
export function clusterRows(sourceId: string, pages: readonly (readonly TextItem[])[]): Row[] {
  const rows: Row[] = [];

  for (const [index, page] of pages.entries()) {
    for (const cluster of clustersOf(page)) {
      rows.push({
        id: `${sourceId}:row:${String(rows.length + 1)}`,
        sourceId,
        page: index + 1,
        items: [...cluster].sort((a, b) => a.x - b.x || a.y - b.y),
        ...band(cluster),
      });
    }
  }

  return rows;
}
