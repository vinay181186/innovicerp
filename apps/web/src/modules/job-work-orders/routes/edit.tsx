// JW new + edit routes (UI-003-04).

import type { CreateJobWorkOrderInput, UpdateJobWorkOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSession } from '@/lib/session';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { uploadJwDocFile, useCreateJwDocument } from '@/modules/jwso-documents/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateJobWorkOrder, useJobWorkOrder, useUpdateJobWorkOrder } from '../api';
import { JobWorkOrderForm } from '../components/job-work-order-form';

/** Upload a picked file to Storage + register it against the JWSO under a given
 *  category. Best-effort: the JWSO is already saved, so a failed upload never
 *  blocks. Used for both the Client PO doc (`po-docs`) and the Email Ref
 *  (`email_reference`). */
async function registerJwDoc(
  file: File | null,
  companyId: string | null | undefined,
  jwId: string,
  jwCode: string,
  createDoc: ReturnType<typeof useCreateJwDocument>,
  category: 'po-docs' | 'email_reference',
  docType: string,
): Promise<void> {
  if (!file || !companyId) return;
  try {
    const storagePath = await uploadJwDocFile(file, companyId);
    await createDoc.mutateAsync({
      jobWorkOrderId: jwId,
      jwCodeText: jwCode,
      category,
      docType,
      fileName: file.name,
      storagePath,
      fileSize: file.size,
      fileType: file.type || undefined,
    });
  } catch {
    // Non-fatal: the JWSO is saved; the doc can be re-attached on the detail page.
  }
}

export const jobWorkOrderNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders/new',
  component: JobWorkOrderNewPage,
});

export const jobWorkOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders/$id/edit',
  component: JobWorkOrderEditPage,
});

function JobWorkOrderNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateJobWorkOrder();
  const createDoc = useCreateJwDocument();
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jw_create');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const poFileRef = useRef<File | null>(null);
  const emailFileRef = useRef<File | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/job-work-orders' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: CreateJobWorkOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      // Upload the chosen Client PO document + Email Ref against the new JWSO
      // (best-effort — the JWSO is already saved).
      await registerJwDoc(
        poFileRef.current,
        me?.companyId,
        created.id,
        created.code,
        createDoc,
        'po-docs',
        'Client PO',
      );
      await registerJwDoc(
        emailFileRef.current,
        me?.companyId,
        created.id,
        created.code,
        createDoc,
        'email_reference',
        'Email Reference',
      );
      exit.leave(
        () =>
          void navigate({ to: '/job-work-orders/$id', params: { id: created.id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save JWSO. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You do not have create access to JWSO Master. Ask an admin for L2 Data Entry or above in
        Sales.
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <JobWorkOrderForm
        mode="create"
        pageTitle="New JWSO Order"
        pageSubtitle="Customer-supplied raw material → we machine and deliver."
        backLabel="Back to JWSO Master"
        onBack={() => exit.leave(goBack)}
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

function JobWorkOrderEditPage(): React.JSX.Element {
  const { id } = jobWorkOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useJobWorkOrder(id);
  const update = useUpdateJobWorkOrder(id);
  const createDoc = useCreateJwDocument();
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jw_create');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const poFileRef = useRef<File | null>(null);
  const emailFileRef = useRef<File | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/job-work-orders/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: UpdateJobWorkOrderInput): Promise<void> => {
    setSubmitError(null);
    try {
      const saved = await update.mutateAsync(values);
      // Upload a newly-picked Client PO document + Email Ref against this JWSO
      // (best-effort).
      await registerJwDoc(
        poFileRef.current,
        me?.companyId,
        id,
        saved.code,
        createDoc,
        'po-docs',
        'Client PO',
      );
      await registerJwDoc(
        emailFileRef.current,
        me?.companyId,
        id,
        saved.code,
        createDoc,
        'email_reference',
        'Email Reference',
      );
      exit.leave(
        () => void navigate({ to: '/job-work-orders/$id', params: { id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save changes. Try again.');
    }
  };

  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You do not have edit access to JWSO Master. Ask an admin for L2 Data Entry or above in
        Sales.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job-work order…
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/job-work-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Job-work order not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <JobWorkOrderForm
        mode="edit"
        detail={detail}
        pageTitle={`Edit Job-Work Order — ${detail.code}`}
        backLabel="Back to JWSO"
        onBack={() => exit.leave(goBack)}
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
