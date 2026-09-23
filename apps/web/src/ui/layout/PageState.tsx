// PageState — the ONE component for every screen state that is not data.
//
// Four states, four placements, one component. It replaces 206 hand-written
// "Loading…" blocks, 61 copies of the same no-access sentence, and the 539
// `.empty-state` usages that today serve loading, empty, error AND no-access
// with no way to tell which is which — the same grey centred text whether the
// list is still arriving, genuinely empty, broken, or hidden from you.
//
// Rule: never write your own "Loading…" div again.
//
//   state="loading"  — the fetch is in flight
//   state="error"    — it failed (also the shell for error-boundary crashes)
//   state="empty"    — it succeeded and there is nothing to show
//   state="noaccess" — the account may not see this page (the app's exact
//                      existing wording, unchanged, so the 61 sites it
//                      replaces read identically)
//
//   as="panel"  (default) a `.panel` card where the list would be
//   as="row"    a <tr> inside an existing tbody — pass colSpan
//   as="inline" a quiet line inside an expanded band
//   as="page"   the whole page
//
// TWO OPEN CROSS-GROUP RULINGS, raised in the Phase-2 review and NOT settled
// here because both land outside this folder:
//   1. FOLDER. design-ref puts this at components/layout/PageState.jsx and
//      README.md:29 lists it under layout/. Moving it means writing into
//      apps/web/src/ui/layout/, which another group owns this round. It is a
//      move plus a re-export, no code change; whoever owns layout does it.
//   2. TONES. ui/data/EmptyState.tsx owns the same `.empty-state` class with
//      a different tone map (--sig-ok / --red against the --red2 / --amber2
//      here). This file keeps the "2" variants deliberately: --red and
//      --amber are FILL colours and fail 4.5:1 as text on white. Composing
//      EmptyState as-is would make every "Failed to load" line fail contrast,
//      so the fix belongs on EmptyState's side, not on this one.

export type PageStateKind = 'loading' | 'error' | 'empty' | 'noaccess';
export type PageStatePlacement = 'panel' | 'row' | 'inline' | 'page';

/** The product's own wording. Changing these changes 200+ screens at once. */
const DEFAULT_MESSAGE: Record<PageStateKind, string> = {
  loading: '⟳ Loading…',
  error: 'Failed to load',
  empty: 'No records',
  noaccess: '⛔ This page is hidden for your access. Ask an admin if you need access to it.',
};

// Text colours are the dark "2" variants — the solid --red / --amber are
// FILLS only and fail 4.5:1 as text (tokens.css). undefined = the
// `.empty-state` grey, which is right for loading and empty.
const TONE: Record<PageStateKind, string | undefined> = {
  loading: undefined,
  error: 'var(--red2)',
  empty: undefined,
  noaccess: 'var(--amber2)',
};

// `page` is --sp-6 (32px) where design-ref/components/layout/PageState.jsx:8
// writes a raw 40. There is no 40px step: design-ref/tokens/spacing.css stops
// at --sp-6, and the rules block says every padding uses one of those. The
// token scale wins over the reference's raw literal.
const PAD: Record<PageStatePlacement, string> = {
  panel: 'var(--sp-5)',
  row: 'var(--sp-5)',
  inline: 'var(--sp-3) var(--sp-4)',
  page: 'var(--sp-6)',
};

export interface PageStateProps {
  state?: PageStateKind;
  /** Replaces the default line. Say what is missing and what to do:
   *  "No orders — click + New SO/WO". */
  message?: React.ReactNode;
  /** A bold line above the message (an error's headline). */
  title?: React.ReactNode;
  /** A big glyph above the text — the empty-state emoji. */
  icon?: React.ReactNode;
  /** One button under the text: Retry, "+ New SO/WO". Never more than one. */
  action?: React.ReactNode;
  as?: PageStatePlacement;
  /** Required when `as="row"` — how many columns the table has. */
  colSpan?: number;
}

export function PageState({
  state = 'empty',
  message,
  title,
  icon,
  action,
  as = 'panel',
  colSpan = 1,
}: PageStateProps): React.JSX.Element {
  const color = TONE[state];
  const text = message ?? DEFAULT_MESSAGE[state];

  const body = (
    <>
      {icon ? <div className="empty-icon">{icon}</div> : null}
      {title ? (
        <div className="fw-700" style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-1)' }}>
          {title}
        </div>
      ) : null}
      <div style={{ fontSize: 'var(--fs-sm)' }}>{text}</div>
      {action ? <div style={{ marginTop: 'var(--sp-3)' }}>{action}</div> : null}
    </>
  );

  // `aria-busy` while loading, `alert` on a failure — a screen reader should
  // not read a spinner as a result, nor miss a broken page.
  const live =
    state === 'loading'
      ? { 'aria-busy': true }
      : state === 'error'
        ? { role: 'alert' as const }
        : {};

  const style: React.CSSProperties = { padding: PAD[as] };
  if (color !== undefined) style.color = color;

  if (as === 'row') {
    return (
      <tr>
        <td colSpan={colSpan} className="empty-state" style={style} {...live}>
          {body}
        </td>
      </tr>
    );
  }

  if (as === 'inline') {
    const inlineStyle: React.CSSProperties = {
      padding: PAD.inline,
      fontSize: 'var(--fs-sm)',
      color: color ?? 'var(--text3)',
    };
    return (
      <div style={inlineStyle} {...live}>
        {body}
      </div>
    );
  }

  return (
    <div className={as === 'page' ? 'empty-state' : 'panel empty-state'} style={style} {...live}>
      {body}
    </div>
  );
}
