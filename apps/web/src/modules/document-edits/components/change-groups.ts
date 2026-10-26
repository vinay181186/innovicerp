// Edit-approval (ADR-202) — sorts the change boxes of one edit request into
// readable groups. ONE place for the field-key grammar, used by the Approvals
// expander and the detail-page pending-line list:
//   <field>                    header field (poDate, remarks …)
//   line:<lineId>:<attr>       one line's field — label "Line 2 · Order Qty"
//   line:add:<n>               a new line        — label "Add line · <code> × <qty> · POL <x>"
//   line:remove:<lineId>       a removed line    — label "Remove line N · <code>"
//   ms:<id>:<attr> / ms:add:<n> / ms:remove:<id>  the same for SO Delivery Schedule rows

import type { DocumentEditChange } from '@innovic/shared';

export type ChangeKind = 'header' | 'edit' | 'add' | 'remove';

export interface ChangeGroup {
  key: string;
  /** Heading shown above the group; null for the header group of a request
   *  that has nothing else (no heading needed). */
  heading: string | null;
  rows: { change: DocumentEditChange; kind: ChangeKind; fieldLabel: string }[];
}

const SEP = ' · ';

/** Split "Line 2 · Order Qty" → ["Line 2", "Order Qty"]; no separator → [null, label]. */
function splitLabel(label: string): [string | null, string] {
  const i = label.indexOf(SEP);
  return i < 0 ? [null, label] : [label.slice(0, i), label.slice(i + SEP.length)];
}

/** Parse a change's field key. `scope` is 'line' / 'ms' for row-level keys. */
export function parseChangeField(field: string): {
  scope: 'line' | 'ms' | null;
  kind: ChangeKind;
  rowId: string | null;
} {
  const m = /^(line|ms):([^:]+)(?::(.+))?$/.exec(field);
  if (!m) return { scope: null, kind: 'header', rowId: null };
  const scope = m[1] as 'line' | 'ms';
  const a = m[2] ?? '';
  const b = m[3] ?? null;
  if (a === 'add') return { scope, kind: 'add', rowId: null };
  if (a === 'remove') return { scope, kind: 'remove', rowId: b };
  return { scope, kind: 'edit', rowId: a };
}

/** Group a request's changes: header fields first, then one group per edited
 *  line / schedule row (first-appearance order), then added + removed rows. */
export function groupChanges(changes: readonly DocumentEditChange[]): ChangeGroup[] {
  const header: ChangeGroup = { key: 'header', heading: 'Header', rows: [] };
  const rowGroups = new Map<string, ChangeGroup>();
  const addRemove: Record<'line' | 'ms', ChangeGroup> = {
    line: { key: 'line:addremove', heading: 'Lines added / removed', rows: [] },
    ms: { key: 'ms:addremove', heading: 'Delivery Schedule rows added / removed', rows: [] },
  };

  for (const c of changes) {
    const p = parseChangeField(c.field);
    if (p.scope === null) {
      header.rows.push({ change: c, kind: 'header', fieldLabel: c.label });
      continue;
    }
    if (p.kind === 'add' || p.kind === 'remove') {
      addRemove[p.scope].rows.push({ change: c, kind: p.kind, fieldLabel: c.label });
      continue;
    }
    const [prefix, rest] = splitLabel(c.label);
    const key = `${p.scope}:${p.rowId ?? ''}`;
    let g = rowGroups.get(key);
    if (!g) {
      let heading = prefix ?? (p.scope === 'ms' ? 'Delivery Schedule' : 'Line');
      if (p.scope === 'ms' && !/schedule/i.test(heading))
        heading = `Delivery Schedule${SEP}${heading}`;
      g = { key, heading, rows: [] };
      rowGroups.set(key, g);
    }
    g.rows.push({ change: c, kind: 'edit', fieldLabel: rest });
  }

  const groups = [header, ...rowGroups.values(), addRemove.line, addRemove.ms].filter(
    (g) => g.rows.length > 0,
  );
  // A plain header-only request needs no heading row (as before).
  const only = groups.length === 1 ? groups[0] : undefined;
  if (only?.key === 'header') only.heading = null;
  return groups;
}
