// "Columns ▾" popover of the fit engine (ADR-199). Columns in on-screen
// order with ▲▼ move, a show/hide tick and a 📌 pin; column 0 is "(always
// first)" and cannot be moved, hidden or unpinned; the Action column is not
// listed (always shown, always last). Ported from the prototype's renderPop().

import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactElement, RefObject } from 'react';

import { cx } from './data-table-cells';
import type { LayoutOp } from '@/lib/table-layout-ops';

import type { LayoutState } from './fit-layout';

export interface PickerColumn {
  id: string;
  label: string;
}

export interface ColumnPickerProps {
  columns: PickerColumn[];
  layout: LayoutState;
  firstId: string;
  dropped: string[];
  flash: string[];
  canPin: (id: string) => boolean;
  onOp: (op: LayoutOp) => void;
  onToast: (msg: string) => void;
  onClose: () => void;
  /** The popover element — the toolbar positions it and tests outside clicks. */
  popRef: RefObject<HTMLDivElement>;
  /** Fixed position computed by the toolbar (it is portalled to <body>). */
  style?: CSSProperties | undefined;
}

export function ColumnPicker({
  columns,
  layout,
  firstId,
  dropped,
  flash,
  canPin,
  onOp,
  onToast,
  onClose,
  popRef: ref,
  style,
}: ColumnPickerProps): ReactElement {
  // `part:id` of the control the user just used — focus returns to it after
  // the change re-draws the list (a ticked column moves between groups).
  const focusAfter = useRef<string | null>(null);
  const labelOf = (id: string) => columns.find((c) => c.id === id)?.label ?? id;
  const shown = layout.order.filter((k) => !layout.hidden.includes(k));
  const hidden = layout.order.filter((k) => layout.hidden.includes(k));

  // Keyboard: focus lands inside on open; Esc closes (the toolbar returns focus).
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
  }, [ref]);

  useEffect(() => {
    const key = focusAfter.current;
    focusAfter.current = null;
    if (!key || !ref.current) return;
    const id = key.slice(key.indexOf(':') + 1);
    const want = ref.current.querySelector<HTMLElement>(`[data-f="${CSS.escape(key)}"]`);
    const el =
      want && !(want as HTMLButtonElement).disabled
        ? want
        : ref.current.querySelector<HTMLElement>(`[data-f="${CSS.escape(`cb:${id}`)}"]`);
    el?.focus();
  }, [layout, ref]);

  // Every action is an OPERATION, so one made before the saved layout has
  // loaded can be replayed on top of it (lib/table-layout-ops.ts).
  const move = (id: string, d: -1 | 1) => {
    focusAfter.current = `${d < 0 ? 'up' : 'dn'}:${id}`;
    onOp({ type: 'move', id, dir: d });
  };

  const setShown = (id: string, show: boolean) => {
    focusAfter.current = `cb:${id}`;
    onOp({ type: show ? 'show' : 'hide', id });
  };

  const togglePin = (id: string) => {
    focusAfter.current = `pin:${id}`;
    if (layout.pins.includes(id)) {
      onOp({ type: 'unpin', id });
      onToast(`${labelOf(id)} unpinned — it may drop on a small screen`);
    } else if (canPin(id)) {
      onOp({ type: 'pin', id });
      onToast(`${labelOf(id)} pinned — it never moves to ▸`);
    } else {
      onToast('No room — unpin another column first');
    }
  };

  const line = (id: string, i: number, isHidden: boolean) => {
    const first = id === firstId;
    const pinned = first || layout.pins.includes(id);
    const drop = dropped.includes(id);
    const label = labelOf(id);
    const pinTitle = pinned
      ? first
        ? 'Always first — never drops'
        : 'Pinned — never drops. Click to unpin'
      : canPin(id)
        ? 'Pin — never drop'
        : 'No room — unpin another column first';
    return (
      <div
        key={id}
        className={cx('dt-pick-item', drop && 'is-drop', flash.includes(id) && 'is-flash')}
      >
        <button
          type="button"
          className="dt-pick-btn"
          data-f={`up:${id}`}
          disabled={first || isHidden || i <= 1}
          onClick={() => move(id, -1)}
          aria-label={`Move ${label} left`}
          title="Move left"
        >
          ▲
        </button>
        <button
          type="button"
          className="dt-pick-btn"
          data-f={`dn:${id}`}
          disabled={first || isHidden || i === shown.length - 1}
          onClick={() => move(id, 1)}
          aria-label={`Move ${label} right`}
          title="Move right"
        >
          ▼
        </button>
        <label className="dt-pick-name">
          <input
            type="checkbox"
            data-f={`cb:${id}`}
            checked={!isHidden}
            disabled={first}
            onChange={(e) => setShown(id, e.target.checked)}
          />
          <span className="dt-pick-label" title={label}>
            {label}
            {first ? <span className="dt-pick-tag"> (always first)</span> : null}
            {drop ? <span className="dt-pick-tag"> · in ▸ (no room)</span> : null}
          </span>
        </label>
        <button
          type="button"
          className={cx('dt-pick-btn', 'dt-pick-pin', !pinned && 'is-off')}
          data-f={`pin:${id}`}
          disabled={first || isHidden}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
          title={pinTitle}
          onClick={() => togglePin(id)}
        >
          📌
        </button>
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className="dt-pick"
      style={style}
      role="dialog"
      aria-label="Columns"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="dt-pick-head">Columns</div>
      <div className="dt-pick-grp">On screen, left → right · ▲▼ move · 📌 never drops</div>
      {/* ONE keyed list, the hidden group after a divider: a column moving
          between the groups keeps its element (and the user's focus). */}
      {[
        ...shown.map((id, i) => line(id, i, false)),
        ...(hidden.length > 0
          ? [
              <div key="__hidden-divider" className="dt-pick-grp dt-pick-divider">
                HIDDEN BY YOU
              </div>,
            ]
          : []),
        ...hidden.map((id, i) => line(id, i, true)),
      ]}
      <div className="dt-pick-foot">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            onOp({ type: 'reset' });
            onToast('Layout reset to default');
          }}
        >
          Reset to default
        </button>
        <span className="dt-pick-note">Saved to your profile</span>
      </div>
    </div>
  );
}
