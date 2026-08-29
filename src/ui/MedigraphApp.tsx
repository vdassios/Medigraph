import type { JSX } from 'preact';

/**
 * The single Preact application island (D2). It will own the
 * attach -> review -> confirm transaction; Task 4.0 gives it real state.
 */
export function MedigraphApp(): JSX.Element {
  return <div class="medigraph-app">Medigraph</div>;
}
