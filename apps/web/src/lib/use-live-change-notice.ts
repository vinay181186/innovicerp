// ADR-230 — the "someone else just changed this" notice for an edit screen that
// does not use useEditConflict (SO and PO edit). Same doorbell, same words, same
// once-per-record rule as useEditConflict's instant warning, so a user reads one
// notice whichever edit screen they are on.
//
// It never touches the form. The guard against overwriting the other person's
// save stays the version check on save (409 edit_conflict); this only tells the
// user sooner. The screen calls `acknowledge()` after its own successful save.

import type { LiveTable } from '@innovic/shared';
import { useEffect, useRef } from 'react';
import { useLiveRecordWatch } from '@/lib/live-updates/live-updates-provider';
import type { RecordWatch } from '@/lib/use-record-watch';
import { useToast } from '@/ui/feedback';

export function useLiveChangeNotice(
  table: LiveTable,
  id: string | undefined,
  noun: string,
): RecordWatch {
  const toast = useToast();
  const watch = useLiveRecordWatch(table, id);
  const { changedByOther } = watch;

  // Wording copied from useEditConflict — keep the two identical.
  const announcedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!changedByOther || !id) return;
    if (announcedFor.current === id) return; // once per record, not per event
    announcedFor.current = id;
    toast.info(`Someone else just changed this ${noun}. Your entry is safe — keep going.`);
  }, [changedByOther, id, noun, toast]);
  useEffect(() => {
    if (!changedByOther) announcedFor.current = null;
  }, [changedByOther]);

  return watch;
}
