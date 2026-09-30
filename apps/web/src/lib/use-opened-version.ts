// R5 — edit conflict (ERPNext "Document has been modified after you have
// opened it"). An edit form remembers the `updatedAt` of the record AS IT WAS
// WHEN THE FORM OPENED and sends it as `expectedUpdatedAt`; the API refuses the
// save with 409 `edit_conflict` ("Changed by someone else after you opened it
// — reload") when the row has moved on since.
//
// It must be captured ONCE: reading the live query value at save time would be
// wrong, because a background refetch (window focus, invalidation) would pull
// in the other person's newer updatedAt and silently defeat the check.
//
// Usage:
//   const { data: detail } = useThing(id);
//   const opened = useOpenedVersion(detail?.updatedAt);
//   ...
//   const saved = await update.mutateAsync({ ...values, expectedUpdatedAt: opened.expected() });
//   opened.saved(saved.updatedAt); // only if the form stays open after saving

import { useRef } from 'react';

export interface OpenedVersion {
  /** The updatedAt the form opened with (undefined until the record loaded). */
  expected: () => string | undefined;
  /** After OUR OWN successful save, the form now holds this version. */
  saved: (updatedAt: string | null | undefined) => void;
  /** Forget the captured version (e.g. the user pressed Reload). */
  reset: () => void;
}

export function useOpenedVersion(updatedAt: string | null | undefined): OpenedVersion {
  const version = useRef<string | undefined>(undefined);
  if (version.current === undefined && updatedAt) version.current = updatedAt;
  const api = useRef<OpenedVersion | null>(null);
  if (api.current === null) {
    api.current = {
      expected: () => version.current,
      saved: (next) => {
        if (next) version.current = next;
      },
      reset: () => {
        version.current = undefined;
      },
    };
  }
  return api.current;
}
