// SO new + edit routes (UI-003-05).

import type { CreateSalesOrderInput, UpdateSalesOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSession } from '@/lib/session';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
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
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'so_create');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const poFileRef = useRef<File | null>(null);
  const emailFileRef = useRef<File | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/sales-orders' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

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
      // Upload the attached email reference the same way (best-effort).
      const emailFile = emailFileRef.current;
      if (emailFile && me?.companyId) {
        try {
          const storagePath = await uploadSoDocFile(emailFile, me.companyId);
          await createDoc.mutateAsync({
            salesOrderId: created.id,
            soCodeText: created.code,
            category: 'email_reference',
            docType: 'Email Reference',
            fileName: emailFile.name,
            storagePath,
            fileSize: emailFile.size,
            fileType: emailFile.type || undefined,
          });
        } catch {
          // Non-fatal: SO is saved; the email ref can be attached on the detail page.
        }
      }
      exit.leave(
        () => void navigate({ to: '/sales-orders/$id', params: { id: created.id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save SO. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You cannot create SOs. Ask an admin.
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      {/* The form renders its own sticky PageHeader (Back · title · Cancel ·
          Save) and Panels — no wrapping panel, which would clip the sticky
          header (.panel is overflow:hidden). Back still passes the exit guard,
          exactly as the old Back link did. */}
      <SalesOrderForm
        mode="create"
        /* Legacy addSO L12425 modal title. */
        title="New SO / WO"
        backLabel="Back to SO Master"
        onBack={goBack}
        onSubmit={onSubmit}
        onPoFileChange={(f) => {
          poFileRef.current = f;
        }}
        onEmailFileChange={(f) => {
          emailFileRef.current = f;
        }}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}

function SalesOrderEditPage(): React.JSX.Element {
  const { id } = salesOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'so_create');
  const { data: detail, isLoading, isError, error } = useSalesOrder(id);
  const update = useUpdateSalesOrder(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/sales-orders/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  // Access matrix: edit access to SO Master is required (also enforced server-side).
  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You cannot edit SOs. Ask an admin.
      </div>
    );
  }

  // Editing a Sales Order is admin-only (enforced again server-side).
  if (me && me.role !== 'admin') {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/sales-orders/$id" params={{ id }} className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to SO
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            🔒 Only an admin can edit a Sales Order.
          </div>
        </div>
      </div>
    );
  }

  const onSubmit = async (values: UpdateSalesOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      exit.leave(() => void navigate({ to: '/sales-orders/$id', params: { id }, replace: true }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save changes. Try again.');
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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Sales order not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <SalesOrderForm
        mode="edit"
        detail={detail}
        /* Legacy _editFullSO L12549 modal title — this route is the all-lines
           editor, so it mirrors that title, not editSOLine's. */
        title={`Edit SO — ${detail.code} (${detail.lines.length} lines)`}
        backLabel="Back to SO"
        onBack={goBack}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
