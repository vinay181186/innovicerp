// JW new + edit routes (UI-003-04).

import type { CreateJobWorkOrderInput, UpdateJobWorkOrderInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { isStagedResult } from '@/modules/document-edits/api';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { useSession } from '@/lib/session';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { uploadJwDocFile, useCreateJwDocument } from '@/modules/jwso-documents/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
import { useCreateJobWorkOrder, useJobWorkOrder, useUpdateJobWorkOrder } from '../api';
import { JobWorkOrderForm } from '../components/job-work-order-form';

/** Upload a picked file to Storage + register it against the JWSO under a given
 *  category. The JWSO is already saved, so a failed upload never blocks — but it
 *  is no longer swallowed: returns a label naming the file that did not attach
 *  (null when nothing was picked or it attached), and the caller opens the JWSO
 *  with a red banner so the user re-uploads from the Documents panel. Used for
 *  both the Client PO doc (`po-docs`) and the Email Ref (`email_reference`). */
async function registerJwDoc(
  file: File | null,
  companyId: string | null | undefined,
  jwId: string,
  jwCode: string,
  createDoc: ReturnType<typeof useCreateJwDocument>,
  category: 'po-docs' | 'email_reference',
  docType: string,
): Promise<string | null> {
  if (!file) return null;
  try {
    if (!companyId) throw new Error('no company');
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
    return null;
  } catch {
    return `${docType} file (${file.name})`;
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
  const saveKey = useSaveKey();
  const create = useCreateJobWorkOrder(saveKey);
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
      // (the JWSO is already saved; a failed upload is reported on the JWSO).
      const failed = [
        await registerJwDoc(
          poFileRef.current,
          me?.companyId,
          created.id,
          created.code,
          createDoc,
          'po-docs',
          'Client PO',
        ),
        await registerJwDoc(
          emailFileRef.current,
          me?.companyId,
          created.id,
          created.code,
          createDoc,
          'email_reference',
          'Email Reference',
        ),
      ].filter((f): f is string => f !== null);
      exit.leave(
        () =>
          void navigate({
            to: '/job-work-orders/$id',
            params: { id: created.id },
            search: failed.length > 0 ? { uploadFailed: failed.join(', ') } : {},
            replace: true,
          }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save JWSO. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to create JWSOs. Ask an admin.
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <JobWorkOrderForm
        mode="create"
        // Money on the form follows the same JWSO price permission the server
        // applies to a saved JWSO (detail.priceVisible on edit).
        priceVisible={perms.price}
        pageTitle="New JWSO"
        backLabel="Back to JWSO Master"
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

function JobWorkOrderEditPage(): React.JSX.Element {
  const { id } = jobWorkOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useJobWorkOrder(id);
  const saveKey = useSaveKey();
  const update = useUpdateJobWorkOrder(id, saveKey);
  // R5 — the version this form opened with; a save over someone else's newer
  // edit is refused (409 edit_conflict) and its message shows in the banner.
  const opened = useOpenedVersion(detail?.updatedAt);
  const createDoc = useCreateJwDocument();
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jw_create');
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE JWSO is staged for approval instead of
  // applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
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
      const saved = await update.mutateAsync({ ...values, expectedUpdatedAt: opened.expected() });
      if (isStagedResult(saved)) {
        // The edit-approval gate is on and this JWSO is live: nothing was
        // changed on the JWSO — the edit is now waiting for approval. Say so,
        // then return to the JWSO (its fields now carry the pending-change
        // chip). A picked Client PO / Email Ref file is not uploaded here while
        // the edit is pending — re-upload it from the Documents panel.
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(
          () => void navigate({ to: '/job-work-orders/$id', params: { id }, replace: true }),
        );
        return;
      }
      opened.saved(saved.updatedAt);
      // Upload a newly-picked Client PO document + Email Ref against this JWSO
      // (a failed upload is reported on the JWSO, never swallowed).
      const failed = [
        await registerJwDoc(
          poFileRef.current,
          me?.companyId,
          id,
          saved.code,
          createDoc,
          'po-docs',
          'Client PO',
        ),
        await registerJwDoc(
          emailFileRef.current,
          me?.companyId,
          id,
          saved.code,
          createDoc,
          'email_reference',
          'Email Reference',
        ),
      ].filter((f): f is string => f !== null);
      exit.leave(
        () =>
          void navigate({
            to: '/job-work-orders/$id',
            params: { id },
            search: failed.length > 0 ? { uploadFailed: failed.join(', ') } : {},
            replace: true,
          }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save changes. Try again.');
    }
  };

  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to edit JWSOs. Ask an admin.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading JWSO…
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
            {error instanceof Error ? error.message : 'JWSO not found. Refresh the page.'}
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
      <JobWorkOrderForm
        mode="edit"
        detail={detail}
        pageTitle={`Edit JWSO ${detail.code}`}
        backLabel="Back to JWSO"
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
