import { useEffect } from 'react';
import { Button, ToastProvider, useToast } from '@innovic/web';

function SaveScreen() {
  const toast = useToast();
  useEffect(() => {
    toast.ok('✓ SO IN-SO-00123 saved', { durationMs: 0 });
    toast.error('Could not save: Client PO No. already used', { durationMs: 0 });
    return () => toast.clear();
  }, [toast]);
  return (
    <Button variant="primary" onClick={() => toast.ok('✓ SO IN-SO-00123 saved')}>
      Save SO
    </Button>
  );
}

export const LiveStack = () => (
  <ToastProvider>
    <SaveScreen />
  </ToastProvider>
);
