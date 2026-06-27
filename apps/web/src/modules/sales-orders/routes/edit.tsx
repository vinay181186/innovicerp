// SO new + edit routes (UI-003-05).

import type { CreateSalesOrderInput, UpdateSalesOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { uploadSoDocFile, useCreateSoDocument } from '@/modules/so-documents/api';
import { useCreateSalesOrder, useSalesOrder, useUpdateSalesOrder } from '../api';
import { SalesOrderForm } from '../components/sales-order-form';

export const salesOrderNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/new',
  component: SalesOrderNewPage,
});

export const salesOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id/edit',
  component: SalesOrderEditPage,
});

function SalesOrderNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateSalesOrder();
  const createDoc = useCreateSoDocument();
  const { data: me } = useSession();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const poFileRef = useRef<File | null>(null);

  const onSubmit = async (values: CreateSalesOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      // Upload the chosen client-PO document against the new SO (legacy
      // addSO L12459 uploads after save). Best-effort — the SO is already saved.
      const poFile = poFileRef.current;
      if (poFile && me?.companyId) {
        try {
          const storagePath = await uploadSoDocFile(poFile, me.companyId);
          await createDoc.mutateAsync({
            salesOrderId: created.id,
            soCodeText: created.code,
            category: 'client_po',
            docType: 'Client PO',
            fileName: poFile.name,
            storagePath,
            fileSize: poFile.size,
            fileType: poFile.type || undefined,
          });
        } catch {
          // Non-fatal: SO is saved; the PO doc can be attached on the detail page.
        }
      }
      await navigate({ to: '/sales-orders/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create sales order');
    }
  };

  return (
    <div>
      <Link to="/sales-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Sales Orders
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">+ New Sales Order</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Header + line items in a single save.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <SalesOrderForm
            mode="create"
            onSubmit={onSubmit}
            onPoFileChange={(f) => { poFileRef.current = f; }}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/sales-orders' })}
          />
        </div>
      </div>
    </div>
  );
}

function SalesOrderEditPage(): React.JSX.Element {
  const { id } = salesOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useSalesOrder(id);
  const update = useUpdateSalesOrder(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateSalesOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/sales-orders/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update sales order');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading sales order…
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/sales-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Sales order not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/sales-orders/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to SO
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Sales Order
            </div>
          </div>
        </div>
        <div className="panel-body">
          <SalesOrderForm
            mode="edit"
            detail={detail}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/sales-orders/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
