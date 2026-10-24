// ADR-235 — the pieces of the ONE Cancel dialog (cancel-doc-dialog.tsx): the
// "cancel these first" blocker list, the "what will happen" effects list, and
// the server-error box that can carry a blocker list from a 409.

import type { CancelBlocker, CancelEffect } from '@innovic/shared';
import { ActionLink } from '@/components/shared/action-link';
import { linkProps } from '@/modules/dashboard/components/dash-text';

/** The documents made from this one, in the order they must be cancelled.
 *  Each Doc No. opens it when the user may open that page (ADR-234), else it
 *  is plain text. */
export function BlockerList({ blockers }: { blockers: CancelBlocker[] }): React.JSX.Element {
  return (
    <ol style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
      {blockers.map((b, i) => (
        <li key={`${b.docLabel}-${b.docNo}-${i}`}>
          <span className="text2">{b.docLabel}</span>{' '}
          {b.href ? (
            <ActionLink
              {...linkProps(b.href)}
              check={b.href}
              fallback="text"
              className="mono fw-700"
              title={`Open ${b.docNo}`}
            >
              {b.docNo}
            </ActionLink>
          ) : (
            <span className="mono fw-700">{b.docNo}</span>
          )}{' '}
          <span className="text3">— {b.reason}</span>
          {b.href ? <span className="text3"> →</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** "+40" / "−40" — the sign says which way the stock or balance moves. */
function signedQty(q: number): string {
  const n = Math.abs(q).toLocaleString('en-IN');
  return q > 0 ? `+${n}` : q < 0 ? `−${n}` : n;
}

export function EffectsList({ effects }: { effects: CancelEffect[] }): React.JSX.Element | null {
  if (effects.length === 0) return null;
  return (
    <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
      {effects.map((e, i) => (
        <li key={`${e.kind}-${i}`}>
          {e.text}
          {e.qty != null ? (
            <span
              className="mono fw-700"
              style={{
                marginLeft: 6,
                color: e.qty < 0 ? 'var(--red2)' : 'var(--green2)',
              }}
            >
              {signedQty(e.qty)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Blockers a 409 may carry in its details — `{ blockers: [...] }` or the bare
 *  array. Anything else is ignored. */
export function blockersFromError(e: unknown): CancelBlocker[] {
  const d = (e as { details?: unknown } | null)?.details;
  const raw = Array.isArray(d)
    ? d
    : d && typeof d === 'object' && Array.isArray((d as { blockers?: unknown }).blockers)
      ? (d as { blockers: unknown[] }).blockers
      : [];
  return raw.filter(
    (b): b is CancelBlocker =>
      !!b &&
      typeof b === 'object' &&
      typeof (b as CancelBlocker).docNo === 'string' &&
      typeof (b as CancelBlocker).docLabel === 'string',
  );
}

export function CancelError({ error }: { error: unknown }): React.JSX.Element | null {
  if (!error) return null;
  const blockers = blockersFromError(error);
  const msg = error instanceof Error ? error.message : 'Could not complete the cancel. Try again.';
  return (
    <div role="alert" className="form-error" style={{ marginTop: 'var(--sp-2)' }}>
      {msg}
      {blockers.length > 0 ? <BlockerList blockers={blockers} /> : null}
    </div>
  );
}
