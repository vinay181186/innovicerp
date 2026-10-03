// SO new + edit routes (UI-003-05).

import type { CreateSalesOrderInput, UpdateSalesOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { isStagedResult } from '@/modules/document-edits/api';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { useSession } from '@/lib/session';
import { soNoWithInternal } from '@/lib/so-number';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
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
  const saveKey = useSaveKey();
  const create = useCreateSalesOrder(saveKey);
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
      // Upload the chosen client-PO document + email reference against the new
      // SO (legacy addSO L12459 uploads after save). The SO is already saved, so
      // a failed upload never undoes it — but it is no longer swallowed: the SO
      // opens with a red banner naming the file that did not attach, and the
      // Client PO bar on that page has the Upload button to retry.
      const failed: string[] = [];
      const uploads: {
        file: File | null;
        category: 'client_po' | 'email_reference';
        docType: string;
        label: string;
      }[] = [
        {
          file: poFileRef.current,
          category: 'client_po',
          docType: 'Client PO',
          label: 'Client PO file',
        },
        {
          file: emailFileRef.current,
          category: 'email_reference',
          docType: 'Email Reference',
          label: 'Email Reference file',
        },
      ];
      for (const u of uploads) {
        if (!u.file) continue;
        try {
          if (!me?.companyId) throw new Error('no company');
          const storagePath = await uploadSoDocFile(u.file, me.companyId);
          await createDoc.mutateAsync({
            salesOrderId: created.id,
            soCodeText: created.code,
            category: u.category,
            docType: u.docType,
            fileName: u.file.name,
            storagePath,
            fileSize: u.file.size,
            fileType: u.file.type || undefined,
          });
        } catch {
          failed.push(`${u.label} (${u.file.name})`);
        }
      }
      exit.leave(
        () =>
          void navigate({
            to: '/sales-orders/$id',
            params: { id: created.id },
            search: failed.length > 0 ? { uploadFailed: failed.join(', ') } : {},
            replace: true,
          }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save SO. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to create SOs. Ask an admin.
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
  const saveKey = useSaveKey();
  const update = useUpdateSalesOrder(id, saveKey);
  // R5 — the version this form opened with; a save over someone else's newer
  // edit is refused (409 edit_conflict) and its message shows in the banner.
  const opened = useOpenedVersion(detail?.updatedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE SO is staged for approval instead of
  // applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/sales-orders/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  // Access matrix: edit access to SO Master is required (also enforced server-side).
  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to edit SOs. Ask an admin.
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
      const saved = await update.mutateAsync({ ...values, expectedUpdatedAt: opened.expected() });
      if (isStagedResult(saved)) {
        // The edit-approval gate is on and this SO is live: nothing was changed
        // on the SO — the edit is now waiting for approval. Say so, then return
        // to the SO (its fields now carry the pending-change chip).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(() => void navigate({ to: '/sales-orders/$id', params: { id }, replace: true }));
        return;
      }
      opened.saved(saved.updatedAt);
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
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      <SalesOrderForm
        mode="edit"
        detail={detail}
        /* Legacy _editFullSO L12549 modal title — this route is the all-lines
           editor, so it mirrors that title, not editSOLine's. */
        title={`Edit SO — ${soNoWithInternal(detail.code, detail.internalSoNo)} (${detail.lines.length} lines)`}
        backLabel="Back to SO"
        onBack={goBack}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
