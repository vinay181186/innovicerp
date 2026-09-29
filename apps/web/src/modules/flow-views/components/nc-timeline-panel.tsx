// NC detail page — the NC Timeline (requirement 3.5, Problem 2.3). READ-ONLY.
//
// Each step of this NC in order — raised → disposed → sent to vendor / rework
// job card → received → returned to the op → re-inspected → closed — with the
// date, the user and the qty. When the material came from a vendor, one line
// says why the only recovery offered is Return to vendor (the same test the
// server's dispose guard runs: nc-register/cascades.ts resolveNcSource).
import { Link } from '@tanstack/react-router';
import { Panel, Timeline, type TimelineEvent } from '@/ui/data';
import { Note } from '@/modules/nc-register/components/nc-note';
import { useNcTimeline } from '../api';
import type { NcTimelineStep, NcTimelineStepKind } from '../types';

const STEP_LOOK: Record<NcTimelineStepKind, { color: string; icon: string }> = {
  raised: { color: 'var(--red2)', icon: '!' },
  split: { color: 'var(--text3)', icon: '⑂' },
  disposed: { color: 'var(--purple)', icon: '⚖' },
  sent_to_vendor: { color: 'var(--blue)', icon: '→' },
  rework_jc: { color: 'var(--cyan)', icon: '♻' },
  received: { color: 'var(--blue)', icon: '←' },
  returned_to_op: { color: 'var(--cyan)', icon: '↩' },
  re_inspected: { color: 'var(--amber)', icon: '✓' },
  closed: { color: 'var(--green)', icon: '■' },
};

const LINK_STYLE: React.CSSProperties = { color: 'var(--cyan)', textDecoration: 'none' };

function DocLink({ doc }: { doc: NonNullable<NcTimelineStep['doc']> }): React.JSX.Element {
  const common = { className: 'mono fw-700', style: LINK_STYLE } as const;
  switch (doc.module) {
    case 'job-cards':
      return (
        <Link to="/job-cards/$id" params={{ id: doc.id }} {...common}>
          {doc.code}
        </Link>
      );
    case 'delivery-challans':
      return (
        <Link to="/delivery-challans/$id" params={{ id: doc.id }} {...common}>
          {doc.code}
        </Link>
      );
    case 'goods-receipt-notes':
      return (
        <Link to="/goods-receipt-notes/$id" params={{ id: doc.id }} {...common}>
          {doc.code}
        </Link>
      );
    default:
      return (
        <Link to="/nc-register/$id" params={{ id: doc.id }} {...common}>
          {doc.code}
        </Link>
      );
  }
}

function toEvent(s: NcTimelineStep, i: number): TimelineEvent {
  const look = STEP_LOOK[s.kind];
  const facts = [
    s.qty != null ? `Qty ${s.qty}` : null,
    s.user ? `By ${s.user}` : 'User not recorded',
    s.detail,
  ].filter(Boolean);
  return {
    key: `${s.kind}-${i}`,
    date: s.at,
    label: s.label,
    detail: facts.join(' · '),
    color: look.color,
    icon: look.icon,
    code: s.doc ? <DocLink doc={s.doc} /> : undefined,
  };
}

export function NcTimelinePanel({ ncId }: { ncId: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useNcTimeline(ncId);
  return (
    <Panel title="NC Timeline" style={{ marginBottom: 'var(--sp-3)' }}>
      {data?.vendorOnly ? (
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <Note tone="blue">Vendor material: can only go back to the vendor.</Note>
        </div>
      ) : null}
      {isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load the NC timeline.'}
        </div>
      ) : isLoading ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <Timeline events={(data?.steps ?? []).map(toEvent)} emptyText="No steps recorded yet." />
      )}
    </Panel>
  );
}
