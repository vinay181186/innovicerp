// Customer Dispatch — one dispatch as a record: what went, on which SO, and
// the Delivery Challan that travels with the truck (Print DC). Save on
// /customer-dispatches/new lands here, so the DC can be printed and the
// invoice raised without hunting for the new DSP on the list.
//
// The page body IS the challan: the same Innovic Sheet markup the print window
// emits, previewed in an iframe (screen = print, as on the invoice detail).

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { SHEET_STYLE } from '@/lib/print/sheet-print';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { PageHeader, PageState } from '@/ui/layout';
import { useDispatchDetail } from '../api';
import { dispatchSheetHtml, printDispatchChallan } from '../lib/print-dc';

export const customerDispatchDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches/$id',
  component: CustomerDispatchDetailPage,
});

function CustomerDispatchDetailPage(): React.JSX.Element {
  const { id } = customerDispatchDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: d, isLoading, isError, error } = useDispatchDetail(id);
  const { data: client } = useClient(d?.clientId ?? undefined);
  const { data: company } = useMyCompany();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dispatch_create');
  const [previewHeight, setPreviewHeight] = useState(1123);

  const docHtml = useMemo(
    () =>
      d
        ? `<!DOCTYPE html><html><head><style>${SHEET_STYLE}.no-print{display:none!important}</style></head><body>${dispatchSheetHtml(d, client, company)}</body></html>`
        : '',
    [d, client, company],
  );

  if (eff && !perms.view) return <PageState as="page" state="noaccess" />;
  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !d) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load the dispatch. Try again.'}
      </div>
    );
  }

  const cancelled = d.status === 'cancelled';

  return (
    <div>
      <PageHeader
        title={`Customer Dispatch ${d.code}`}
        icon="🚚"
        subtitle={
          <>
            {d.customer ?? '—'} · SO No.{' '}
            <Link to="/sales-orders/$id" params={{ id: d.salesOrderId }} className="fw-700">
              {d.soCode ?? '—'}
            </Link>{' '}
            · {fmtDate(d.dispatchDate)} · {d.totalQty} pcs
            {cancelled ? ' · Cancelled' : ''}
          </>
        }
        backLabel="Back to Customer Dispatch"
        onBack={() => void navigate({ to: '/customer-dispatches' })}
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (!printDispatchChallan(d, client, company)) {
                  window.alert('Allow popups to print.');
                }
              }}
            >
              🖨 Print DC
            </button>
            {!cancelled && d.billedStatus !== 'full' ? (
              <Link
                to="/invoices/new"
                search={{ dispatchId: d.id }}
                className="btn btn-primary"
                title="Raise an invoice against this dispatch"
              >
                🧾 Create Invoice
              </Link>
            ) : null}
          </>
        }
      />

      {/* A4-portrait paper preview — identical markup to the print output. */}
      <iframe
        title={`Delivery Challan ${d.code} preview`}
        // Self-built, esc()'d sheet HTML shared with the print window.
        srcDoc={docHtml}
        onLoad={(e) => {
          const h = e.currentTarget.contentDocument?.documentElement.scrollHeight;
          if (h) setPreviewHeight(h);
        }}
        style={{
          display: 'block',
          width: '100%',
          maxWidth: 860,
          height: previewHeight,
          margin: '0 auto 14px',
          border: 'none',
          borderRadius: 4,
        }}
      />

      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="Dispatch" entityId={d.id} refId={d.code} />
      </Panel>
    </div>
  );
}
