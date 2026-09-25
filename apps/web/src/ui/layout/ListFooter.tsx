// ListFooter — the count line under every list, in ONE of two modes.
//
//   scroll mode (document + master lists, one fetch)
//     "Showing all 23 sales orders"
//     "Showing first 1000 of 1240 — refine with search"   (when `limit` is hit)
//     "Showing 12 of 42 vendors"                          (client-side filter)
//   pager mode (unbounded registers only — GRN, DC, op log, store txns,
//     activity — the ones that keep `page` in the URL)
//     "Showing 26–50 of 312"  + Prev / Page 2 / 5 / Next
//
// Never both: passing `page` switches the line to the pager. Under the line sit
// the 💡 interaction hint and any Excel template / import buttons.

import type { ReactNode } from 'react';
import { Icon } from '../core/Icon';

export interface ListFooterProps {
  /** Total matching records the server reports. */
  total: number;
  /** Rows actually on screen after a client-side filter. */
  shown?: number | undefined;
  /** Singular noun: "sales order", "vendor", "GRN". */
  noun?: string | undefined;
  /** Plural when it is not noun + "s". */
  nounPlural?: string | undefined;
  /** Scroll-mode fetch cap (1000 for SO, 200 for JC / PO / JWSO). */
  limit?: number | undefined;
  /** Set to switch to the Prev/Next pager — unbounded registers only. */
  page?: number | undefined;
  pageSize?: number | undefined;
  onPage?: ((p: number) => void) | undefined;
  /** Interaction hint, e.g. "Click a row to open its detail page." */
  hint?: ReactNode | undefined;
  /** ⬇ Download Excel Template / 📄 Import from Excel. */
  actions?: ReactNode | undefined;
}

export function ListFooter({
  total,
  shown,
  noun = 'record',
  nounPlural,
  limit,
  page,
  pageSize = 25,
  onPage,
  hint,
  actions,
}: ListFooterProps): React.JSX.Element {
  const plural = nounPlural ?? `${noun}s`;
  const paged = page != null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const text =
    total === 0
      ? `No ${plural}`
      : paged
        ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
        : // limit={0} is a "no cap" sentinel, not a cap of nothing — it must
          // fall through to "Showing all N", never "Showing first 0 of N".
          limit != null && limit > 0 && total > limit
          ? `Showing first ${limit} of ${total} — refine with search`
          : shown != null && shown !== total
            ? `Showing ${shown} of ${total} ${plural}`
            : `Showing all ${total} ${total === 1 ? noun : plural}`;

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: paged ? 'space-between' : 'flex-end',
          alignItems: 'center',
          marginTop: 'var(--sp-2)',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text3)',
        }}
      >
        <span>{text}</span>
        {paged ? (
          <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => onPage?.(page - 1)}
            >
              {/* One chevron glyph, mirrored — the icon set has no chevron-left. */}
              <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}>
                <Icon name="chevron-right" size={14} />
              </span>{' '}
              Prev
            </button>
            <span style={{ fontFamily: 'var(--mono)', padding: '0 var(--sp-2)' }}>
              Page {page} / {pages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page >= pages}
              onClick={() => onPage?.(page + 1)}
            >
              Next <Icon name="chevron-right" size={14} />
            </button>
          </div>
        ) : null}
      </div>
      {hint ? (
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text3)',
            marginTop: 'var(--sp-1)',
            padding: '0 var(--sp-1)',
          }}
        >
          💡 {hint}
        </div>
      ) : null}
      {actions ? (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          {actions}
        </div>
      ) : null}
    </>
  );
}
