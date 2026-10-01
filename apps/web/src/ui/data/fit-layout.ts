// Fit-engine layout maths (ADR-199). Pure, so it is easy to reason about:
// measured widths + the user's layout + the available width in, the columns
// to draw (and their px widths) and the columns moved into ▸ out.
// Ported from Table-Standard-Prototype.html (`layout()`, `canPin()`).

import type { DataTableColumnKind } from './data-table-types';

/** Room the 📌 marker takes in a pinned column's header, px. */
export const PIN_W = 14;
/** Text columns never get less than this (unless the header / content is narrower). */
export const TEXT_MIN = 120;
/** Text columns stop asking for spare width at this. */
export const TEXT_IDEAL_MAX = 300;

export interface ColumnWidth {
  /** Never narrower than this. */
  min: number;
  /** Wants this much when there is spare room. */
  ideal: number;
}

export interface LayoutState {
  order: string[];
  pins: string[];
  hidden: string[];
}

export interface FitInput extends LayoutState {
  firstId: string;
  kinds: Record<string, DataTableColumnKind>;
  widths: Record<string, ColumnWidth>;
  /** Width of the wrapper, px. */
  avail: number;
  /** Width the Action column takes (always shown, last), px. 0 when none. */
  actionsW: number;
  /** Width the leading selection tick-box column takes, px. 0 when none. */
  selW: number;
}

export interface FitResult {
  visible: string[];
  dropped: string[];
  /** px width per visible column (Action column excluded). */
  w: Record<string, number>;
  /** The pins alone did not fit — the rightmost pin was moved to ▸. */
  warn: boolean;
  /** Width available to the data columns, px. */
  budget: number;
}

/** Measured header + content width -> the column's min / ideal. */
export function columnWidth(
  kind: DataTableColumnKind,
  head: number,
  content: number,
  floor: number,
): ColumnWidth {
  if (kind === 'text') {
    const min = Math.max(head, Math.min(content, TEXT_MIN), floor);
    return { min, ideal: Math.max(min, Math.min(content, TEXT_IDEAL_MAX)) };
  }
  // Every other kind — including `control` (an in-cell input / picker) — takes
  // its exact measured width and never shares the spare room (min === ideal).
  const w = Math.max(head, content, floor);
  return { min: w, ideal: w };
}

/** Columns that must never be dropped into ▸: user-pinned, and `control`
 *  columns (an in-cell input / picker is force-pinned by its kind). */
function undroppable(input: FitInput, id: string): boolean {
  return input.pins.includes(id) || input.kinds[id] === 'control';
}

function minOf(input: FitInput, id: string): number {
  const base = input.widths[id]?.min ?? 0;
  return base + (id !== input.firstId && input.pins.includes(id) ? PIN_W : 0);
}

export function visibleIds(state: LayoutState): string[] {
  return state.order.filter((k) => !state.hidden.includes(k));
}

export function fitColumns(input: FitInput): FitResult {
  const vis = visibleIds(input);
  const budget = Math.max(0, input.avail - input.actionsW - input.selW);
  const need = (list: string[]) => list.reduce((s, k) => s + minOf(input, k), 0);
  const dropped: string[] = [];
  let warn = false;

  // Drop the rightmost droppable column until the minimums fit. Column 0 and
  // `control` columns are never dropped; when only pins (and controls) are
  // left, the rightmost non-control pin goes (warning).
  while (need(vis) > budget) {
    let idx = -1;
    for (let i = vis.length - 1; i > 0; i -= 1) {
      const k = vis[i];
      if (k !== undefined && !undroppable(input, k)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      // Only pinned / control columns remain: force-drop the rightmost pin, but
      // a control column still never drops.
      for (let i = vis.length - 1; i > 0; i -= 1) {
        const k = vis[i];
        if (k !== undefined && input.kinds[k] !== 'control') {
          idx = i;
          break;
        }
      }
      if (idx < 0) break; // nothing left but control columns (+ column 0)
      warn = true;
    }
    if (idx <= 0) break;
    const [gone] = vis.splice(idx, 1);
    if (gone !== undefined) dropped.unshift(gone);
  }

  const w: Record<string, number> = {};
  for (const k of vis) w[k] = minOf(input, k);
  let spare = budget - need(vis);

  // Share the spare width between text columns in proportion to what each
  // still wants; anything left after that goes evenly to the text columns
  // (or every column when there is no text column).
  const texts = vis.filter((k) => input.kinds[k] === 'text');
  const wantOf = (k: string) => Math.max(0, (input.widths[k]?.ideal ?? 0) - minOf(input, k));
  const want = texts.reduce((a, k) => a + wantOf(k), 0);
  if (want > 0 && spare > 0) {
    const give = Math.min(spare, want);
    for (const k of texts) w[k] = (w[k] ?? 0) + Math.floor((give * wantOf(k)) / want);
    spare = budget - Object.values(w).reduce((a, b) => a + b, 0);
  }
  if (spare > 0 && vis.length > 0) {
    const targets = texts.length > 0 ? texts : vis;
    const each = Math.floor(spare / targets.length);
    for (const k of targets) w[k] = (w[k] ?? 0) + each;
  }
  return { visible: vis, dropped, w, warn, budget };
}

/** Would column 0 + every pin + this column still fit? (prototype `canPin`). */
export function canPin(input: FitInput, id: string): boolean {
  if (id === input.firstId || input.pins.includes(id)) return true;
  const keep = visibleIds(input).filter(
    (k) => k === input.firstId || k === id || input.pins.includes(k),
  );
  const total = keep.reduce((s, k) => s + minOf(input, k) + (k === id ? PIN_W : 0), 0);
  return total <= Math.max(0, input.avail - input.actionsW - input.selW);
}
