// Line-detail modal (legacy _qcDocLineDetail L23226). Opened by clicking a JC
// row in the matrix: QC inspection batches + per-doc-type upload/view/download/
// delete sections. Split out of routes/list.tsx. Unchanged behaviour.

import type { QcLineDetailResponse } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSession } from '@/lib/session';
import { saveQcDoc, useQcLineDetail } from '../api';
import { DocSection } from './doc-section';
import { useMaySaveFiles } from './qc-doc-shared';

export function LineDetailModal({
  jobCardId,
  onClose,
}: {
  jobCardId: string;
  onClose: () => void;
}): React.JSX.Element {
  // `me` is still needed for the company id the upload path writes against.
  const { data: me } = useSession();
  // Tier-driven, per department (QC), replacing the old role list
  // (admin/manager/qc). Attaching a document is `entry`; removing one is the
  // L5-and-above pair — see `canDelete` below.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'qcdocs_upload');
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve. L3
  // Editor has edit without approve; L4 Approver has approve without edit. The
  // owner decided L5 gets delete rights — admin-only was locking out the very
  // tier meant to run the department.
  const canDelete = perms.edit && perms.approve;
  const { data, isLoading, isError, error } = useQcLineDetail(jobCardId);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(1100px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">
            QC Documents{' '}
            {data
              ? `— ${itemCodeWithRev(data.itemCode, data.itemRevision, '')} (${data.jcCode})`
              : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          {isLoading ? (
            <div className="empty-state">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load line details. Try again.'}
            </div>
          ) : data ? (
            <LineDetailBody
              data={data}
              jobCardId={jobCardId}
              canUpload={perms.entry}
              canDelete={canDelete}
              companyId={me?.companyId ?? null}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LineDetailBody({
  data,
  jobCardId,
  canUpload,
  canDelete,
  companyId,
}: {
  data: QcLineDetailResponse;
  jobCardId: string;
  canUpload: boolean;
  canDelete: boolean;
  companyId: string | null;
}): React.JSX.Element {
  const maySave = useMaySaveFiles();
  return (
    <div>
      {/* Header (legacy L23263-23269) */}
      <div
        style={{
          padding: 12,
          background: 'var(--bg3)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 16,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          {/* POL — the customer's own PO line number, read-only here; it is
              typed only on the Sales Order. */}
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>POL</span>
          <br />
          <b className="mono" style={{ color: 'var(--purple)' }}>
            {data.clientPoLineNo ?? '—'}
          </b>
        </div>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Item Code</span>
          <br />
          <b className="mono fw-700" style={{ color: 'var(--text)' }}>
            {itemCodeWithRev(data.itemCode, data.itemRevision, '')}
          </b>{' '}
          {data.itemName ?? ''}
        </div>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>JC No.</span>
          <br />
          <b style={{ color: 'var(--cyan)' }}>{data.jcCode}</b>
        </div>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Order Qty</span>
          <br />
          <b>{data.orderQty} pcs</b>
        </div>
        {maySave ? (
          <div style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: 'rgba(34,197,94,0.1)',
                color: 'var(--green2)',
                border: '1px solid rgba(34,197,94,0.3)',
              }}
              disabled={!data.sections.some((s) => s.docs.some((d) => d.storagePath))}
              onClick={() => void downloadAllLine(data)}
            >
              ⬇ Download All
            </button>
          </div>
        ) : null}
      </div>

      {/* QC Inspection Batches (legacy L23271-23290) */}
      {data.batches.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            QC Inspection Batches ({data.batches.length})
          </div>
          {data.batches.map((b, i) => (
            <div
              key={b.logId}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '6px 10px',
                margin: '3px 0',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
                Batch {i + 1}
              </span>
              <span>{fmtDate(b.date, '')}</span>
              <span>
                Op {opSrNo(b.opSeq)}: <b>{b.operation}</b>
              </span>
              <span style={{ color: 'var(--green2)' }}>
                Accepted: <b>{b.accepted}</b>
              </span>
              {b.rejected > 0 ? (
                <span style={{ color: 'var(--red2)' }}>
                  Deviated: <b>{b.rejected}</b>
                </span>
              ) : null}
              <span className="mono fw-700" style={{ color: 'var(--cyan)', marginLeft: 'auto' }}>
                Pieces {b.srFrom} to {b.srTo}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Document sections (legacy L23293-23357) */}
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>QC Documents</div>
      {data.sections.map((section) => (
        <DocSection
          key={section.docType}
          jobCardId={jobCardId}
          jcCode={data.jcCode}
          section={section}
          totalNeeded={data.totalAccepted}
          canUpload={canUpload}
          canDelete={canDelete}
          companyId={companyId}
        />
      ))}
    </div>
  );
}

async function downloadAllLine(data: QcLineDetailResponse): Promise<void> {
  const paths = data.sections.flatMap((s) => s.docs.map((d) => d.storagePath)).filter(Boolean);
  if (paths.length === 0) return;
  for (const p of paths) {
    try {
      await saveQcDoc(p, null, data.jcCode);
    } catch {
      // skip
    }
  }
}
