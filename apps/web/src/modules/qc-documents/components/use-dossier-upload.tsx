// ADR-252 — ＋ upload / ↻ replace from the Dossier. One hidden file input; the
// caller says what the file is for, the user picks it, the file goes to
// Storage (`${companyId}/qc-docs/…`) and is registered with POST /qc-documents.
// ↻ is the same call on the same QC entry: the old file stays as an earlier
// revision (D4). One idempotency key per upload (§20, useSaveKey): the key is
// shared only by retries of the SAME upload (same QC entry / report slot and the
// same picked file). Any other target or file rotates it first — the server's
// idempotency plugin replays by key without comparing bodies, so a kept key
// from a timed-out upload would otherwise answer a different entry's upload
// with the first one's row.

import type { CreateQcDocumentInput } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { useSaveKey } from '@/lib/use-save-key';
import { QC_REPORT_ACCEPT, attachmentSizeError, attachmentTypeAllowed } from '@innovic/shared';
import { qcDocumentsKeys, uploadQcFile, useCreateQcDocument } from '../api';

/** What the picked file belongs to. */
export type UploadTarget =
  | { opLogId: string; label: string }
  | { reportTypeId: string; soLineId?: string; jwLineId?: string; label: string };

/** One key per upload slot: a QC entry, or a report folder on one POL. */
export function uploadSlotKey(
  t:
    | { opLogId: string }
    | { reportTypeId: string; soLineId?: string | undefined; jwLineId?: string | undefined },
): string {
  return 'opLogId' in t
    ? `op:${t.opLogId}`
    : `rt:${t.reportTypeId}:${t.soLineId ?? ''}:${t.jwLineId ?? ''}`;
}

export function useDossierUpload(): {
  start: (t: UploadTarget) => void;
  input: React.JSX.Element;
  busyLabel: string | null;
  err: string | null;
  clearErr: () => void;
  /** Slots (uploadSlotKey) whose upload saved but whose refetched dossier has not arrived. */
  refreshing: ReadonlySet<string>;
} {
  const qc = useQueryClient();
  const companyId = useSession().data?.companyId ?? null;
  const saveKey = useSaveKey();
  const create = useCreateQcDocument(saveKey);
  const ref = useRef<HTMLInputElement>(null);
  const target = useRef<UploadTarget | null>(null);
  /** Identity of the upload the current key belongs to (target + picked file). */
  const keyOwner = useRef<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());

  function start(t: UploadTarget): void {
    setErr(null);
    target.current = t;
    ref.current?.click();
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    const t = target.current;
    if (!file || !t) return;
    if (!attachmentTypeAllowed(file.name, QC_REPORT_ACCEPT)) {
      setErr(`${file.name}: only PDF, JPG, PNG, Word or Excel files.`);
      return;
    }
    const tooBig = attachmentSizeError(file);
    if (tooBig) {
      setErr(tooBig);
      return;
    }
    if (!companyId) {
      setErr('Session expired. Log in again.');
      return;
    }
    // Same target + same file = a retry of the same upload → keep the key.
    // Anything else is a new upload → fresh key.
    const owner = JSON.stringify([
      'opLogId' in t
        ? ['op', t.opLogId]
        : ['rt', t.reportTypeId, t.soLineId ?? '', t.jwLineId ?? ''],
      file.name,
      file.size,
      file.lastModified,
    ]);
    if (keyOwner.current !== owner) {
      saveKey.rotate();
      keyOwner.current = owner;
    }
    setBusyLabel(t.label);
    try {
      const storagePath = await uploadQcFile(file, companyId);
      const input: CreateQcDocumentInput = {
        category: 'qc-docs',
        fileName: file.name,
        storagePath,
        ...('opLogId' in t
          ? { opLogId: t.opLogId }
          : {
              reportTypeId: t.reportTypeId,
              ...(t.soLineId ? { soLineId: t.soLineId } : {}),
              ...(t.jwLineId ? { jwLineId: t.jwLineId } : {}),
            }),
      };
      await create.mutateAsync(input);
      // Saved. Until the refetched dossier arrives the row still reads "no report"
      // with a live ＋ — mark the slot so a second upload cannot start meanwhile.
      const slot = uploadSlotKey(t);
      setRefreshing((prev) => new Set(prev).add(slot));
      setBusyLabel(null);
      try {
        // cancelRefetch:false joins the refetch the mutation's onSuccess began.
        await qc.invalidateQueries({ queryKey: qcDocumentsKeys.all }, { cancelRefetch: false });
      } finally {
        setRefreshing((prev) => {
          const next = new Set(prev);
          next.delete(slot);
          return next;
        });
      }
    } catch (e2) {
      // The server's own words (e.g. "This QC entry belongs to another order").
      setErr(e2 instanceof Error ? e2.message : 'Could not upload the report. Try again.');
    } finally {
      setBusyLabel(null);
    }
  }

  const input = (
    <input
      ref={ref}
      type="file"
      accept={QC_REPORT_ACCEPT}
      style={{ display: 'none' }}
      onChange={(e) => void onPick(e)}
    />
  );
  return { start, input, busyLabel, err, clearErr: () => setErr(null), refreshing };
}
