// Job Card VIEW page — the Documents & Quality tab body (2026-09-18 mockup):
// cards for what this card actually has: each QC document (opens the file), open
// QC calls (→ QC Call Register on this card), NCs (→ NC register on this card).
// No card for a thing that does not exist; no "Manage Documents". No Drawing
// card: the header's Drawing row + thumbnail already open the drawing (Round 5,
// one way in). The page's tabs are the shared TabStrip in jc-status-view.tsx.
//
// Presentation only. Every figure is one the page already loaded.
import type { JcOpEnriched, JobCardListItem, JobCardStatusExtras } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { drawingViewUrl } from '@/lib/drawing-url';
import { fmtJcDate } from '../lib/fmt-jc-date';

// ─── Documents & Quality cards ───────────────────────────────────────────────

/** One document card: icon · title · sub-line. A button when it opens a file
 *  or a modal, a Link when it navigates to a register, plain when it only
 *  informs (the register links are permission-gated by the caller — the card
 *  then still shows the figure, as information is never gated here). */
function DocCard({
  icon,
  iconBg,
  title,
  sub,
  onClick,
  link,
  hint,
}: {
  icon: string;
  iconBg: string;
  title: string;
  sub: React.ReactNode;
  onClick?: (() => void) | undefined;
  link?: { to: 'qc-call-register' | 'nc-register'; search: string } | null;
  hint?: string;
}): React.JSX.Element {
  const body = (
    <>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 7,
          background: iconBg,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          className="fw-700"
          style={{ display: 'block', fontSize: 12.5, color: 'var(--text)', whiteSpace: 'nowrap' }}
        >
          {title}
        </span>
        <span
          className="mono"
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--text3)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 220,
          }}
        >
          {sub}
        </span>
      </span>
    </>
  );
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 11px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 9,
    minWidth: 170,
    textAlign: 'left',
    textDecoration: 'none',
    color: 'inherit',
    cursor: onClick || link ? 'pointer' : 'default',
    font: 'inherit',
  };
  if (link?.to === 'qc-call-register') {
    return (
      <Link to="/qc-call-register" search={{ search: link.search }} title={hint} style={style}>
        {body}
      </Link>
    );
  }
  if (link?.to === 'nc-register') {
    return (
      <Link to="/nc-register" search={{ search: link.search }} title={hint} style={style}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={hint} style={style}>
        {body}
      </button>
    );
  }
  return (
    <div title={hint} style={style}>
      {body}
    </div>
  );
}

function DocumentsTab({
  jc,
  ops,
  extras,
  stopped,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  extras: JobCardStatusExtras | undefined;
  stopped: boolean;
}): React.JSX.Element {
  const { data: eff } = useMyAccess();
  // The two register links carry the same gates as the op-card buttons that
  // open the same screens (jc-op-actions.tsx): QC Call Register → qc_submit
  // .view, NC register → nc_dispose.view. Without the right the card stays
  // (it is information) but does not link; hidden as a link until the access
  // matrix has loaded, like every other action button.
  const canQc = effectiveFormPerms(eff, 'qc_submit').view;
  const canNc = effectiveFormPerms(eff, 'nc_dispose').view;

  // QC Calls = the QC operations with pieces waiting to be inspected right now
  // (qcPending > 0) — the same condition that shows 🔬 Inspect (n) on the op
  // card. The enriched op carries no qc_call_date, so this is calls OPEN, not
  // calls ever raised. Pieces waiting go on the sub-line.
  const qcOps = ops.filter((o) => o.opType === 'qc');
  const openQcCalls = qcOps.filter((o) => o.qcPending > 0);
  const qcPendingPcs = openQcCalls.reduce((s, o) => s + o.qcPending, 0);
  // NC Report = the NC entries in the server-merged completion log (every NC
  // is included in full; only op_log is ever capped — see jobCardStatusExtras).
  const ncEvents = (extras?.completionLog.events ?? []).filter((e) => e.kind === 'nc');
  const ncPcs = ncEvents.reduce((s, e) => s + (e.rejectedQty ?? 0), 0);

  const qcDocs = extras?.qcDocs ?? [];
  const openQcDoc = (storagePath: string): void => {
    // The link is minted by the SERVER in view mode (since 2026-09-11), so the
    // open is logged and no attachment disposition is handed out by the
    // browser's own session.
    void drawingViewUrl({ path: storagePath, source: 'qc_document', refCode: jc.code }).then(
      (url) => window.open(url, '_blank', 'noopener'),
    );
  };

  const nothing = qcDocs.length === 0 && qcOps.length === 0 && ncEvents.length === 0;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {qcDocs.map((d) => (
        <DocCard
          key={d.id}
          icon="📄"
          iconBg="var(--blue3)"
          title={d.docType}
          sub={d.fileName || '—'}
          onClick={d.storagePath ? () => openQcDoc(d.storagePath) : undefined}
          hint={`${d.fileName || 'No file'}${d.uploadDate ? ` · added ${fmtJcDate(d.uploadDate)}` : ''}`}
        />
      ))}
      {qcOps.length > 0 ? (
        <DocCard
          icon="🔬"
          iconBg="var(--amber3)"
          title="QC Calls"
          sub={
            openQcCalls.length > 0
              ? `${openQcCalls.length} open · ${qcPendingPcs} pcs waiting`
              : 'None open'
          }
          hint={
            stopped
              ? 'The Production Order was short closed — no QC can be called on this job card.'
              : canQc
                ? 'Open the QC Call Register on this job card'
                : 'QC operations with pieces waiting to be inspected'
          }
          link={!stopped && canQc ? { to: 'qc-call-register', search: jc.code } : null}
        />
      ) : null}
      {ncEvents.length > 0 ? (
        <DocCard
          icon="⚠"
          iconBg="var(--red3)"
          title="NC Report"
          sub={`${ncEvents.length} NC · ${ncPcs} pcs`}
          hint={
            stopped
              ? 'The Production Order was short closed — these NCs are a record only.'
              : canNc
                ? 'Open the NC register filtered to this job card'
                : 'Non-conformances raised on this job card'
          }
          link={!stopped && canNc ? { to: 'nc-register', search: jc.code } : null}
        />
      ) : null}
      {nothing ? (
        <div className="empty-state" style={{ padding: 16, width: '100%' }}>
          No QC document, QC call or NC on this job card yet.
        </div>
      ) : null}
    </div>
  );
}

/** The Documents & Quality tab body on its own — today's cards, unchanged — for
 *  the fit-to-screen Job Card detail (jc-status-view.tsx), which owns its own
 *  tab strip. */
export function JcDocumentsTab(props: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  extras: JobCardStatusExtras | undefined;
  stopped: boolean;
}): React.JSX.Element {
  return <DocumentsTab {...props} />;
}
