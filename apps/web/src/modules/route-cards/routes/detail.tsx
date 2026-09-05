// Route Card detail page — header + ops table + revision history.
// Mirrors legacy viewRouteCard modal (L10143).

import type { RouteCardRevision } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Printer,
  Trash2,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItem } from '../../items/api';
import { useMyCompany } from '../../settings/api';
import { useDeleteRouteCard, useRouteCard } from '../api';
import { printRouteCard } from '../lib/print-route-card';

export const routeCardDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards/$id',
  component: RouteCardDetailPage,
});

function RouteCardDetailPage(): React.JSX.Element {
  const { id } = routeCardDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useRouteCard(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'routecard_create');
  const { data: item } = useItem(detail?.itemId);
  const { data: company } = useMyCompany();
  const del = useDeleteRouteCard();
  const [delError, setDelError] = useState<string | null>(null);

  const onPrint = (): void => {
    if (!detail) return;
    if (!printRouteCard({ rc: detail, item, company })) {
      window.alert('Allow popups to print.');
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!detail) return;
    if (!window.confirm(`Delete route card "${detail.code}"? This soft-deletes the record.`))
      return;
    setDelError(null);
    try {
      await del.mutateAsync(detail.id);
      void navigate({ to: '/route-cards' });
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading route card…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/route-cards" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Route card not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/route-cards" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Route Cards
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code cyan" style={{ fontSize: 16, fontWeight: 800 }}>
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <span style={{ color: 'var(--purple)' }}>{detail.itemCode ?? '—'}</span>
              <span className="text2">{detail.itemName ?? '— unknown item —'}</span>
              <span
                className="mono"
                style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700 }}
              >
                Rev {detail.currentRevision}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
              <Printer size={13} /> Print
            </button>
            {perms.edit && (
              <Link
                to="/route-cards/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit / Revise
              </Link>
            )}
            {perms.edit && perms.approve && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void onDelete()}
                disabled={del.isPending}
                title="Delete route card"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            {/* Raw material sits FIRST, right under the item code / name in the
                header: grade + size describe WHAT the part is cut from, so they
                read with the item identity, not buried under Notes. Both are
                optional — a card with neither still shows the pair as dashes,
                because a missing grade is a gap worth seeing. */}
            <div className="form-grp">
              <span className="form-label">RM Grade</span>
              <div className="mono fw-700">{detail.rawMaterialGradeText ?? '—'}</div>
            </div>
            <div className="form-grp">
              <span className="form-label">RM Size</span>
              <div className="mono fw-700">{detail.rawMaterialSizeText ?? '—'}</div>
            </div>
            <div className="form-grp">
              <span className="form-label">Operations</span>
              <div className="mono fw-700">{detail.ops.length}</div>
            </div>
            <div className="form-grp">
              <span className="form-label">Last Updated</span>
              <div className="text2" style={{ fontSize: 12 }}>
                {new Date(detail.updatedAt).toISOString().slice(0, 10)}
              </div>
            </div>
            <div className="form-grp form-full">
              <span className="form-label">Notes</span>
              <div className="text2">{detail.notes ?? '—'}</div>
            </div>
          </div>
          {delError ? (
            <div
              style={{
                marginTop: 8,
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              {delError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">⚙️ Operation Sequence ({detail.ops.length})</div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Type</th>
                <th>Machine / Vendor</th>
                <th>Operation</th>
                <th className="td-ctr">Cycle(h)</th>
                <th>Program / Lead</th>
                <th>Tool No.</th>
                <th>Tool Details</th>
              </tr>
            </thead>
            <tbody>
              {detail.ops.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No operations
                  </td>
                </tr>
              ) : (
                detail.ops.map((op) => {
                  // Op-type accents follow legacy's own convention: the sequence
                  // number is text3 on process rows (L10147/L10237), green on QC
                  // (L10213) and purple on OSP (L10226).
                  const accent =
                    op.opType === 'qc'
                      ? 'var(--green)'
                      : op.opType === 'outsource'
                        ? 'var(--purple)'
                        : 'var(--text3)';
                  const bg =
                    op.opType === 'qc'
                      ? 'rgba(34,197,94,0.06)'
                      : op.opType === 'outsource'
                        ? 'rgba(124,58,237,0.06)'
                        : undefined;
                  // machTag (L1980) renders the machine as a cyan `.tag` chip:
                  // code on a bold line, machine name on a 9px text3 line under
                  // it. OSP/QC rows reuse the chip with their own accent.
                  const tagColor =
                    op.opType === 'qc'
                      ? 'var(--green)'
                      : op.opType === 'outsource'
                        ? 'var(--purple)'
                        : 'var(--cyan)';
                  const tagCode =
                    op.opType === 'outsource'
                      ? (op.ospVendorCode ?? op.ospVendorCodeText ?? '—')
                      : (op.machineCode ?? op.machineCodeText ?? '—');
                  const tagName = op.opType === 'outsource' ? op.ospVendorName : op.machineName;
                  return (
                    <tr key={op.id} style={{ background: bg }}>
                      <td className="td-ctr mono fw-700" style={{ color: accent }}>
                        {op.opSeq}
                      </td>
                      <td>
                        <span className="badge" style={{ color: accent, fontWeight: 700 }}>
                          {op.opType.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span
                          className="tag"
                          style={{
                            background: 'var(--bg4)',
                            color: tagColor,
                            lineHeight: 1.25,
                            verticalAlign: 'top',
                          }}
                        >
                          <span style={{ fontWeight: 700, display: 'block' }}>{tagCode}</span>
                          {tagName ? (
                            <span
                              style={{
                                fontSize: 9,
                                color: 'var(--text3)',
                                fontWeight: 400,
                                display: 'block',
                              }}
                            >
                              {tagName}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="fw-700">{op.operation}</td>
                      <td className="td-ctr mono">{Number(op.cycleTimeMin) || '—'}</td>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--blue)' }}>
                        {op.opType === 'outsource'
                          ? op.ospLeadDays != null
                            ? `${op.ospLeadDays}d lead`
                            : '—'
                          : (op.program ?? '—')}
                      </td>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
                        {op.toolNo ?? '—'}
                      </td>
                      <td className="text3" style={{ fontSize: 12 }}>
                        {op.toolDetails ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail.revisions.length > 0 ? <RevisionHistory revisions={detail.revisions} /> : null}
    </div>
  );
}

// ─── Revision history ─────────────────────────────────────────────────────
//
// Every revision has always carried a FULL snapshot of the operations as they
// stood at that revision — the server keeps it as JSON precisely so the trail
// survives the live op rows being wiped and rewritten on each save. The panel
// used to print the length of that array and nothing else, so the history could
// say Rev 2 held eight operations without saying what they were.
//
// Each row opens now. The colours and chips deliberately match the live
// operations table above, so an old routing reads exactly like the current one.

function opAccent(opType: string): string {
  return opType === 'qc'
    ? 'var(--green)'
    : opType === 'outsource'
      ? 'var(--purple)'
      : 'var(--text3)';
}

function RevisionHistory({ revisions }: { revisions: RouteCardRevision[] }): React.JSX.Element {
  // One revision open at a time. Two snapshots expanded in a single column read
  // as one long undifferentiated list, which is worse than showing neither.
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">▸ Revision History ({revisions.length})</div>
        <div className="text3" style={{ fontSize: 11 }}>
          Click a revision to see the operations it held
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th>Rev</th>
              <th>Date</th>
              <th>By</th>
              <th>Notes</th>
              <th className="td-ctr">Ops</th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((rev) => {
              const open = openId === rev.id;
              return (
                <Fragment key={rev.id}>
                  <tr
                    onClick={() => setOpenId(open ? null : rev.id)}
                    style={{ cursor: 'pointer' }}
                    title={open ? 'Hide the operations' : 'Show the operations at this revision'}
                  >
                    <td className="td-ctr text3">
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--amber)' }}>
                      Rev {rev.revisionNo}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {new Date(rev.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {rev.createdByName ?? '—'}
                    </td>
                    <td className="text2" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                      {rev.notes ?? '—'}
                    </td>
                    <td className="td-ctr mono">{rev.opsSnapshot.length}</td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--bg3)', padding: '8px 12px 12px' }}>
                        <div
                          className="text3"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '.07em',
                            marginBottom: 6,
                          }}
                        >
                          ROUTING AT REV {rev.revisionNo}
                        </div>
                        <div className="tbl-wrap">
                          <table className="innovic-table">
                            <thead>
                              <tr>
                                <th className="td-ctr">#</th>
                                <th>Type</th>
                                <th>Machine / Vendor</th>
                                <th>Operation</th>
                                <th className="td-ctr">Cycle</th>
                                <th>Program / Lead</th>
                                <th>Tool No</th>
                                <th>Tool Details</th>
                                <th className="td-ctr">QC</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rev.opsSnapshot.map((op) => {
                                const accent = opAccent(op.opType);
                                return (
                                  <tr key={`${rev.id}-${op.opSeq}`}>
                                    <td className="td-ctr mono fw-700" style={{ color: accent }}>
                                      {op.opSeq}
                                    </td>
                                    <td>
                                      <span
                                        className="badge"
                                        style={{ color: accent, fontWeight: 700 }}
                                      >
                                        {op.opType.toUpperCase()}
                                      </span>
                                    </td>
                                    <td className="mono" style={{ fontSize: 12 }}>
                                      {op.opType === 'outsource'
                                        ? (op.ospVendorCode ?? '—')
                                        : (op.machineCode ?? '—')}
                                    </td>
                                    <td className="fw-700">{op.operation}</td>
                                    <td className="td-ctr mono">{Number(op.cycleTimeMin) || '—'}</td>
                                    <td className="mono" style={{ fontSize: 12, color: 'var(--blue)' }}>
                                      {op.opType === 'outsource'
                                        ? op.ospLeadDays != null
                                          ? `${op.ospLeadDays}d lead`
                                          : '—'
                                        : (op.program ?? '—')}
                                    </td>
                                    <td className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
                                      {op.toolNo ?? '—'}
                                    </td>
                                    <td className="text3" style={{ fontSize: 12 }}>
                                      {op.toolDetails ?? '—'}
                                    </td>
                                    {/* undefined means this revision predates the
                                        QC flag being snapshotted. Shown as "not
                                        recorded" — never guessed as a No. */}
                                    <td
                                      className="td-ctr"
                                      style={{
                                        color:
                                          op.qcRequired === true ? 'var(--green)' : 'var(--text3)',
                                      }}
                                      title={
                                        op.qcRequired === undefined
                                          ? 'Not recorded — this revision predates QC being kept in the history'
                                          : undefined
                                      }
                                    >
                                      {op.qcRequired === undefined
                                        ? '—'
                                        : op.qcRequired
                                          ? 'Yes'
                                          : 'No'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
