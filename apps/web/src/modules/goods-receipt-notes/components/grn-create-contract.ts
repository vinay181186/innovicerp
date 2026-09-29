// What <UnifiedGrnForm> and its three type forms share.
//
// The Save button lives in the shell's sticky PageHeader, but each type form
// owns its own submit handler. The button reaches it through the HTML `form`
// attribute (`<button type="submit" form={GRN_CREATE_FORM_ID}>`), and the form
// reports back whether it is saving / blocked / dirty so the header button and
// the "Not saved" pill stay truthful.

import type { ReactNode } from 'react';

export const GRN_CREATE_FORM_ID = 'grn-create-form';

export interface GrnFormStatus {
  submitting: boolean;
  /** Save is not allowed right now (e.g. the picked PO is not receivable). */
  blocked: boolean;
  /** The user has picked or typed something. */
  dirty: boolean;
}

export interface GrnTypeFormShellProps {
  /** The GRN Type picker, rendered as the first field of the form's header grid. */
  typeField: ReactNode;
  onStatusChange: (s: GrnFormStatus) => void;
}
