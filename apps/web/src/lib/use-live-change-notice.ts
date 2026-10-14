// ADR-230 — the "someone else just changed this" notice for an edit screen that
// does not use useEditConflict (SO and PO edit). Same doorbell, same words, same
// once-per-record rule as useEditConflict's instant warning, so a user reads one
// notice whichever edit screen they are on.
//
// It never touches the form. The guard against overwriting the other person's
// save stays the version check on save (409 edit_conflict); this only tells the
// user sooner.
//
// Our OWN save causes a change message too. Pass `saving` (the update
// mutation's isPending): while it is true, and for LIVE_OWN_SAVE_GRACE_MS after
// it ends, a message is taken to be our own echo and silently cleared. A real
// change by someone else in that window is still caught by the version check.

import type { LiveTable } from '@innovic/shared';
import { useEffect, useRef } from 'react';
import { LIVE_OWN_SAVE_GRACE_MS } from '@/lib/live-updates/constants';
import { useLiveRecordWatch } from '@/lib/live-updates/live-updates-provider';
import type { RecordWatch } from '@/lib/use-record-watch';
import { useToast } from '@/ui/feedback';

export function useLiveChangeNotice(
  table: LiveTable,
  id: string | undefined,
  noun: string,
  saving: boolean,
): RecordWatch {
  const toast = useToast();
  const watch = useLiveRecordWatch(table, id);
  const { changedByOther, acknowledge } = watch;

  // When our own save last finished (0 = not this mount).
  const wasSaving = useRef(false);
  const savedAt = useRef(0);
  useEffect(() => {
    if (wasSaving.current && !saving) savedAt.current = Date.now();
    wasSaving.current = saving;
  }, [saving]);

  // Wording copied from useEditConflict — keep the two identical.
  const announcedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!changedByOther || !id) return;
    if (saving || Date.now() - savedAt.current < LIVE_OWN_SAVE_GRACE_MS) {
      acknowledge(); // our own echo
      return;
    }
    if (announcedFor.current === id) return; // once per record, not per event
    announcedFor.current = id;
    toast.info(`Someone else just changed this ${noun}. Your entry is safe — keep going.`);
  }, [changedByOther, id, noun, toast, saving, acknowledge]);
  useEffect(() => {
    if (!changedByOther) announcedFor.current = null;
  }, [changedByOther]);

  return watch;
}
