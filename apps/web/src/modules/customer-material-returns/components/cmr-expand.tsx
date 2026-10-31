// What the ▸ row reveals under a Customer Material Return line (ADR-199 fit
// table). The register is one row per return LINE (ADR-261), so the old nested
// lines table is gone; what is left is the return's Remarks / cancel reason
// and its own History (ADR-197) — there is no detail page to show them.

import type { CustomerMaterialReturnLineRow } from '@innovic/shared';
import { DocumentHistory } from '@/components/shared/document-history';
import { Panel } from '@/ui/data';

export function CmrExpand({ r }: { r: CustomerMaterialReturnLineRow }): React.JSX.Element {
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        className="text3"
        style={{
          fontSize: 'var(--fs-xs)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-4)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        <span>
          <b>Party GRN No.:</b> {r.partyGrnCode ?? '—'}
        </span>
        <span>
          <b>Remarks:</b> {r.remarks ?? '—'}
        </span>
        {r.docStatus === 'cancelled' ? (
          <span style={{ color: 'var(--red2)' }}>
            <b>Cancel Reason:</b> {r.cancelReason ?? '—'}
          </span>
        ) : null}
      </div>

      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="CustomerMaterialReturn" entityId={r.docId} refId={r.docCode} />
      </Panel>
    </div>
  );
}
