// Preview / ⬇ Download for one SO or JWSO — the ONE entry point the SO and
// JWSO lists (row ⋯) and detail pages (⋯) share. Loads the order (fresh from
// the server) and its customer, builds the sheet (lib/print-order.ts), then either opens
// the in-app preview or saves `<code>.pdf`.

import type {
  Client,
  Company,
  JobWorkOrderDetail,
  ListPrintTemplatesResponse,
  SalesOrderDetail,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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

export function useOrderPrint(): {
  preview: (kind: OrderKind, id: string, draft?: boolean) => void;
  download: (kind: OrderKind, id: string, draft?: boolean) => void;
  modal: React.JSX.Element | null;
} {
  const qc = useQueryClient();
  const { data: me } = useSession();
  const [open, setOpen] = useState<{ model: SheetPrintModel; code: string } | null>(null);

  // Detail first, then the customer. A customer the user may not read prints the order's own name.
  const build = async (
    kind: OrderKind,
    id: string,
    draft?: boolean,
  ): Promise<{ model: SheetPrintModel; code: string }> => {
    // staleTime 0: print what is saved NOW, not a cached copy from before
    // someone else's edit. Company + templates are awaited too, so an early
    // click from a list never prints without the letterhead or the terms.
    const fresh = { staleTime: 0 } as const;
    const [company, templates] = await Promise.all([
      qc.fetchQuery({
        queryKey: companyKeys.me(),
        queryFn: () => apiFetch<Company>('/companies/me'),
      }),
      qc.fetchQuery({
        queryKey: printTemplatesKeys.list(),
        queryFn: () => apiFetch<ListPrintTemplatesResponse>('/print-templates'),
      }),
    ]);
    const base = {
      company,
      templates: templates.items,
      currentUser: me?.email,
      draft,
    };
    const clientOf = (clientId: string | null): Promise<Client | null> =>
      clientId
        ? qc
            .fetchQuery({
              queryKey: clientsKeys.detail(clientId),
              queryFn: () => apiFetch<Client>(`/clients/${clientId}`),
            })
            .catch(() => null)
        : Promise.resolve(null);
    if (kind === 'so') {
      const so = await qc.fetchQuery({
        queryKey: salesOrdersKeys.detail(id),
        queryFn: () => apiFetch<SalesOrderDetail>(`/sales-orders/${id}`),
        ...fresh,
      });
      const client = await clientOf(so.clientId);
      return { model: salesOrderSheet({ ...base, so, client }), code: so.code };
    }
    const jw = await qc.fetchQuery({
      queryKey: jobWorkOrdersKeys.detail(id),
      queryFn: () => apiFetch<JobWorkOrderDetail>(`/job-work-orders/${id}`),
      ...fresh,
    });
    const client = await clientOf(jw.clientId);
    return { model: jwSalesOrderSheet({ ...base, jw, client }), code: jw.code };
  };

  const fail = (e: unknown): void =>
    window.alert(e instanceof Error ? e.message : 'Could not prepare the document. Try again.');

  return {
    preview: (kind, id, draft) => {
      build(kind, id, draft).then(setOpen, fail);
    },
    download: (kind, id, draft) => {
      build(kind, id, draft)
        .then(({ model, code }) => downloadSheetPdf(model, code))
        .catch(fail);
    },
    modal: open ? (
      <SheetPreviewModal model={open.model} fileName={open.code} onClose={() => setOpen(null)} />
    ) : null,
  };
}
