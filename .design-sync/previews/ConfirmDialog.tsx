import { ConfirmDialog } from '@innovic/web';

const noop = () => {};

export const DeleteQuestion = () => (
  <ConfirmDialog
    inline
    title="Delete SO IN-SO-00123?"
    message="This Sales Order moves to Trash. An administrator can restore it."
    confirmLabel="Delete"
    onConfirm={noop}
    onCancel={noop}
  />
);

export const PrimaryQuestion = () => (
  <ConfirmDialog
    inline
    tone="primary"
    title="Approve PO IN-MPO-00311?"
    message="The vendor Sample Metals Pvt Ltd can be sent this order once it is approved."
    confirmLabel="Approve"
    onConfirm={noop}
    onCancel={noop}
  />
);

export const TypedConfirm = () => (
  <ConfirmDialog
    inline
    title="Empty Trash?"
    message="This removes 14 documents for good."
    warnings={['This cannot be undone.', 'Attached drawings and QC reports go with them.']}
    requireTyped="DELETE"
    confirmLabel="Empty Trash"
    onConfirm={noop}
    onCancel={noop}
  />
);

export const WithError = () => (
  <ConfirmDialog
    inline
    title="Cancel JC IN-JC-00456?"
    message="Stock issued to this Job Card returns to Store."
    confirmLabel="Cancel Job Card"
    cancelLabel="Keep"
    errorText="Could not cancel: 20 NOS have already been dispatched."
    onConfirm={noop}
    onCancel={noop}
  />
);
