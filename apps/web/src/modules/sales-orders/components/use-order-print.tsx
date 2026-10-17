// Preview / ⬇ Download for one SO or JWSO — the ONE entry point the SO and
// JWSO lists (row ⋯) and detail pages (⋯) share. Builds the sheet
// (lib/print-order.ts) from the order + its customer + company + print
// templates, then either shows it in the in-app preview or saves `<code>.pdf`.
//
// Speed (owner 2026-10-17: list preview "not open", detail "too much time"):
//   - the preview box opens AT THE CLICK, showing "Loading preview…";
//   - company + templates are warmed when the page mounts;
//   - every load runs in parallel — the caller passes the clientId it already
//     has (list row / detail), so the customer never waits for the order;
//   - the detail page passes the order it has already loaded (no refetch);
//     a list fetches it fresh, so another user's edit is never printed stale.

import type {
  Client,
  Company,
  JobWorkOrderDetail,
  ListPrintTemplatesResponse,
  SalesOrderDetail,
} from '@innovic/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SheetPreviewModal } from '@/components/shared/sheet-preview-modal';
import { apiFetch } from '@/lib/api';
import { downloadSheetPdf } from '@/lib/print/sheet-pdf';
import type { SheetPrintModel } from '@/lib/print/sheet-print';
import { useSession } from '@/lib/session';
import { clientsKeys } from '@/modules/clients/api';
import { jobWorkOrdersKeys } from '@/modules/job-work-orders/api';
import { printTemplatesKeys } from '@/modules/print-templates/api';
import { companyKeys } from '@/modules/settings/api';
import { salesOrdersKeys } from '../api';
import { jwSalesOrderSheet, salesOrderSheet } from '../lib/print-order';

export type OrderKind = 'so' | 'jwso';

export type OrderPrintTarget =
  | { kind: 'so'; id: string; code: string; clientId: string | null; detail?: SalesOrderDetail }
  | {
      kind: 'jwso';
      id: string;
      code: string;
      clientId: string | null;
      detail?: JobWorkOrderDetail;
    };

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};
const templatesQuery = {
  queryKey: printTemplatesKeys.list(),
  queryFn: () => apiFetch<ListPrintTemplatesResponse>('/print-templates'),
};

function fetchClient(qc: QueryClient, clientId: string | null): Promise<Client | null> {
  if (!clientId) return Promise.resolve(null);
  return qc
    .fetchQuery({
      queryKey: clientsKeys.detail(clientId),
      queryFn: () => apiFetch<Client>(`/clients/${clientId}`),
    })
    .catch(() => null); // a customer the user may not read prints the order's own name
}

export function useOrderPrint(): {
  preview: (t: OrderPrintTarget, draft?: boolean) => void;
  download: (t: OrderPrintTarget, draft?: boolean) => Promise<void>;
  modal: React.JSX.Element | null;
} {
  const qc = useQueryClient();
  const { data: me } = useSession();
  const [open, setOpen] = useState<{
    code: string;
    title: string;
    model: SheetPrintModel | null;
    error: string | null;
  } | null>(null);

  // Warm the two company-wide reads so the first click does not wait on them.
  useEffect(() => {
    void qc.prefetchQuery(companyQuery);
    void qc.prefetchQuery(templatesQuery);
  }, [qc]);

  const build = async (t: OrderPrintTarget, draft?: boolean): Promise<SheetPrintModel> => {
    const order =
      t.detail ??
      qc.fetchQuery({
        queryKey: t.kind === 'so' ? salesOrdersKeys.detail(t.id) : jobWorkOrdersKeys.detail(t.id),
        queryFn: () =>
          apiFetch<SalesOrderDetail | JobWorkOrderDetail>(
            t.kind === 'so' ? `/sales-orders/${t.id}` : `/job-work-orders/${t.id}`,
          ),
        staleTime: 0,
      });
    const [company, templates, client, detail] = await Promise.all([
      qc.fetchQuery(companyQuery),
      qc.fetchQuery(templatesQuery),
      fetchClient(qc, t.clientId),
      order,
    ]);
    const base = { company, templates: templates.items, client, currentUser: me?.email, draft };
    return t.kind === 'so'
      ? salesOrderSheet({ ...base, so: detail as SalesOrderDetail })
      : jwSalesOrderSheet({ ...base, jw: detail as JobWorkOrderDetail });
  };

  const message = (e: unknown): string =>
    e instanceof Error ? e.message : 'Could not prepare the document. Try again.';

  return {
    preview: (t, draft) => {
      const title = t.kind === 'so' ? 'Sales Order' : 'JW Sales Order';
      setOpen({ code: t.code, title, model: null, error: null });
      build(t, draft).then(
        (model) => setOpen((o) => (o?.code === t.code ? { ...o, model } : o)),
        (e: unknown) => setOpen((o) => (o?.code === t.code ? { ...o, error: message(e) } : o)),
      );
    },
    // Returned, not fired-and-forgotten: the row ⋯ shows busy until it is saved.
    download: (t, draft) =>
      build(t, draft)
        .then((model) => downloadSheetPdf(model, t.code))
        .catch((e: unknown) => window.alert(message(e))),
    modal: open ? (
      <SheetPreviewModal
        title={open.title}
        fileName={open.code}
        model={open.model}
        error={open.error}
        onClose={() => setOpen(null)}
      />
    ) : null,
  };
}
