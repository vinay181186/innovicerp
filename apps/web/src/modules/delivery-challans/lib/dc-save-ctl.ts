// Header Save wiring for +New DC (routes/create.tsx). Save lives in the sticky
// page header, but the save handler belongs to whichever form body is mounted
// (none while a picker is showing). The body reports its state here and keeps
// `submitRef` pointed at its own save. Split out of create.tsx so the
// return-to-vendor form body (components/nc-dc-form.tsx) can use it too.

import { useEffect } from 'react';

export interface DcSaveState {
  canSave: boolean;
  saving: boolean;
  dirty: boolean;
}
export const NO_SAVE: DcSaveState = { canSave: false, saving: false, dirty: false };
export interface DcSaveCtl {
  setState: (s: DcSaveState) => void;
  submitRef: React.MutableRefObject<() => void>;
}

/** A form body reports its Save state to the page header while mounted, and
 *  clears it on unmount (back to a picker, or the other source). */
export function useReportSave(ctl: DcSaveCtl, s: DcSaveState): void {
  const { canSave, saving, dirty } = s;
  const { setState } = ctl;
  useEffect(() => {
    setState({ canSave, saving, dirty });
  }, [setState, canSave, saving, dirty]);
  useEffect(() => () => setState(NO_SAVE), [setState]);
}
