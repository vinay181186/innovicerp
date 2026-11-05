import { Toast, ToastStack } from '@innovic/web';

export const Kinds = () => (
  <ToastStack inline>
    <Toast kind="ok">✓ SO IN-SO-00123 saved</Toast>
    <Toast kind="info">Line 2 sent for approval</Toast>
    <Toast kind="warn">Stock for BRKT-101/A is below minimum</Toast>
    <Toast kind="err">Could not save: Client PO No. already used</Toast>
  </ToastStack>
);

export const Dismissible = () => (
  <ToastStack inline>
    <Toast kind="ok" onDismiss={() => {}}>✓ GRN IN-GRN-00078 received: 50 NOS</Toast>
  </ToastStack>
);

export const FromItems = () => (
  <ToastStack
    inline
    onDismiss={() => {}}
    toasts={[
      { id: 't1', kind: 'ok', message: '✓ JC IN-JC-00456 closed', durationMs: 0 },
      { id: 't2', kind: 'err', message: 'Could not print: session expired', durationMs: 0 },
    ]}
  />
);
