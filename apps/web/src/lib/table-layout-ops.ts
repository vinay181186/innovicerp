// The user's Columns-menu actions as OPERATIONS (ADR-199). A change made
// before the saved layout has been read is queued as an operation and later
// REPLAYED on top of the saved layout — never saved as a whole state built on
// the defaults, which would overwrite what the user saved earlier.

export interface LayoutShape {
  order: string[];
  pins: string[];
  hidden: string[];
}

export type LayoutOp =
  | { type: 'move'; id: string; dir: -1 | 1 }
  | { type: 'hide'; id: string }
  | { type: 'show'; id: string }
  | { type: 'pin'; id: string }
  | { type: 'unpin'; id: string }
  | { type: 'reset' };

/** The locked block at the front: column 0 alone, or the six lead columns
 *  (ui/data/lead-columns.tsx). A string is the old "column 0 only" form. */
export function lockedList(locked: string | readonly string[] | undefined): readonly string[] {
  if (locked === undefined) return [];
  return typeof locked === 'string' ? [locked] : locked;
}

/** Apply one operation. A locked column (column 0, or the lead block) can
 *  never move, hide or unpin, and no other column can move into the block. */
export function applyLayoutOp(
  state: LayoutShape,
  op: LayoutOp,
  first: string | readonly string[] | undefined,
  defaults: LayoutShape,
): LayoutShape {
  if (op.type === 'reset') return defaults;
  const locked = lockedList(first);
  if (locked.includes(op.id)) return state;
  const floor = Math.max(1, locked.length);
  const shown = state.order.filter((k) => !state.hidden.includes(k));
  const hidden = state.order.filter((k) => state.hidden.includes(k));
  switch (op.type) {
    case 'move': {
      const i = shown.indexOf(op.id);
      const j = i + op.dir;
      if (i < floor || j < floor || j >= shown.length) return state;
      const list = [...shown];
      const a = list[i];
      const b = list[j];
      if (a === undefined || b === undefined) return state;
      list[i] = b;
      list[j] = a;
      return { ...state, order: [...list, ...hidden] };
    }
    case 'hide':
      if (state.hidden.includes(op.id)) return state;
      return {
        ...state,
        hidden: [...state.hidden, op.id],
        pins: state.pins.filter((k) => k !== op.id),
      };
    case 'show': {
      if (!state.hidden.includes(op.id)) return state;
      // Back into its own slot (code order), never tacked on at the end.
      const rank = (k: string) => defaults.order.indexOf(k);
      const mine = rank(op.id);
      let at = mine < 0 ? -1 : shown.findIndex((k, idx) => idx >= floor && rank(k) > mine);
      if (at < 0) at = shown.length;
      return {
        ...state,
        hidden: state.hidden.filter((k) => k !== op.id),
        order: [
          ...shown.slice(0, at),
          op.id,
          ...shown.slice(at),
          ...hidden.filter((k) => k !== op.id),
        ],
      };
    }
    case 'pin':
      return state.pins.includes(op.id) || state.hidden.includes(op.id)
        ? state
        : { ...state, pins: [...state.pins, op.id] };
    case 'unpin':
      return { ...state, pins: state.pins.filter((k) => k !== op.id) };
  }
}
