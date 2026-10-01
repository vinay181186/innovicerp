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

/** Apply one operation. `first` (column 0) can never move, hide or unpin. */
export function applyLayoutOp(
  state: LayoutShape,
  op: LayoutOp,
  first: string | undefined,
  defaults: LayoutShape,
): LayoutShape {
  if (op.type === 'reset') return defaults;
  if (op.id === first) return state;
  const shown = state.order.filter((k) => !state.hidden.includes(k));
  const hidden = state.order.filter((k) => state.hidden.includes(k));
  switch (op.type) {
    case 'move': {
      const i = shown.indexOf(op.id);
      const j = i + op.dir;
      if (i < 1 || j < 1 || j >= shown.length) return state;
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
    case 'show':
      if (!state.hidden.includes(op.id)) return state;
      return {
        ...state,
        hidden: state.hidden.filter((k) => k !== op.id),
        order: [...shown, op.id, ...hidden.filter((k) => k !== op.id)],
      };
    case 'pin':
      return state.pins.includes(op.id) || state.hidden.includes(op.id)
        ? state
        : { ...state, pins: [...state.pins, op.id] };
    case 'unpin':
      return { ...state, pins: state.pins.filter((k) => k !== op.id) };
  }
}
