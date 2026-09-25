// StatusPills (+ ViewToggle) — the pill-shaped status FILTER chips that form
// the second row of a list page's header
// (design-ref/components/layout/StatusPills.*; live pattern:
// modules/sales-orders/routes/list.tsx, goods-receipt-notes, plans, bom-master,
// op-entry/op-log-history).
//
// This is the ONLY place a 999px pill is allowed in the system — every other
// chip is a 4px rounded rect (Badge / Tag). Active pill = btn-primary, the
// rest are btn-ghost.
//
// Which one to use on a list page (never both, per design-ref):
//   • statuses that carry COUNTS      → StatStrip
//   • statuses that are just a filter → StatusPills
//
// FOLDER, open item: audit/02-element-inventory.md:337 and design-ref put
// StatusPills (+ViewToggle) under ui/layout/, and ui/layout/ListHeader.tsx
// documents StatusPills as what fills its children slot — so `ui/layout` is
// where a Phase-3 screen will reach for it. The file is still here because
// this round owns ui/navigation/ ONLY: creating ui/layout/StatusPills.tsx and
// re-pointing ui/layout/index.ts are edits in another agent's folder. The move
// is a rename plus two barrel lines, with no change to the markup below.
//
// `right` is the cluster on the far side — normally <ViewToggle/>.
// Presentational only: the caller owns `value`, so /__ui-kit can render every
// state with no data fetch.

export interface StatusPillOption {
  value: string;
  label: string;
}

export interface StatusPillsProps {
  /** Enum values (underscores render as spaces) or {value,label}. */
  options: Array<string | StatusPillOption>;
  /** null = the "All" pill. */
  value?: string | null;
  onChange?: (v: string | null) => void;
  allLabel?: string;
  /** Right-hand cluster — usually <ViewToggle/>. */
  right?: React.ReactNode;
  /** Accessible name for the filter group. */
  label?: string;
}

/** The one pill shape. 999px is a pill radius, not a spacing value, so it has
 *  no token — it is stated once here rather than repeated per button. */
const PILL_STYLE: React.CSSProperties = {
  borderRadius: 999,
  padding: '0 var(--sp-3)',
  textTransform: 'capitalize',
};

export function StatusPills({
  options,
  value = null,
  onChange,
  allLabel = 'All',
  right,
  label = 'Filter by status',
}: StatusPillsProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        flexWrap: 'wrap',
      }}
    >
      <div
        role="group"
        aria-label={label}
        style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}
      >
        {/* null is prepended, so "All" is always the first pill. */}
        {[null, ...options].map((o) => {
          const v = o == null ? null : typeof o === 'string' ? o : o.value;
          const text =
            o == null ? allLabel : typeof o === 'string' ? o.replace(/_/g, ' ') : o.label;
          const on = value === v;
          return (
            <button
              key={v ?? '__all'}
              type="button"
              className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={on}
              style={PILL_STYLE}
              onClick={() => onChange?.(v)}
            >
              {text}
            </button>
          );
        })}
      </div>
      {right ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>{right}</div>
      ) : null}
    </div>
  );
}

export interface ViewToggleProps {
  value?: 'list' | 'card';
  onChange?: (v: 'list' | 'card') => void;
  /** Current expand-all state — the button label flips to "Collapse all". */
  expandAll?: boolean;
  /** Omitted, the expand-all button and its divider are not rendered. */
  onExpandAll?: () => void;
}

/** Expand all / Collapse all + ☰ List View / ▦ Card View. Sits in
 *  StatusPills' `right` slot. */
export function ViewToggle({
  value = 'list',
  onChange,
  expandAll = false,
  onExpandAll,
}: ViewToggleProps): React.JSX.Element {
  return (
    <>
      {onExpandAll ? (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onExpandAll}>
            {expandAll ? 'Collapse all' : 'Expand all'}
          </button>
          {/* Hairline separator between the expand control and the view pair. */}
          <span
            aria-hidden
            style={{
              width: 1,
              height: 'var(--sp-4)',
              background: 'var(--border2)',
              margin: '0 var(--sp-1)',
            }}
          />
        </>
      ) : null}
      <button
        type="button"
        className={`btn btn-sm ${value === 'list' ? 'btn-primary' : 'btn-ghost'}`}
        aria-pressed={value === 'list'}
        onClick={() => onChange?.('list')}
      >
        ☰ List View
      </button>
      <button
        type="button"
        className={`btn btn-sm ${value === 'card' ? 'btn-primary' : 'btn-ghost'}`}
        aria-pressed={value === 'card'}
        onClick={() => onChange?.('card')}
      >
        ▦ Card View
      </button>
    </>
  );
}
