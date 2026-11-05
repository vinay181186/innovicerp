import { useEffect, useRef, type ReactNode } from 'react';
import { ActionMenu, Button } from '@innovic/web';

/** The menu opens on click; click it once so the card shows the real menu. */
const Opened = ({ children }: { children: ReactNode }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
  }, []);
  return (
    <div ref={box} style={{ minHeight: 190, display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
      {children}
    </div>
  );
};

const noop = () => {};

export const Closed = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Button variant="primary">Approve</Button>
    <ActionMenu
      items={[
        { label: 'Print', icon: 'printer', onClick: noop },
        { label: 'Cancel PO', danger: true, onClick: noop },
      ]}
    />
  </div>
);

export const Open = () => (
  <Opened>
    <ActionMenu
      items={[
        { label: 'Print', icon: 'printer', onClick: noop },
        { label: 'Download PDF', icon: 'download', onClick: noop },
        { label: 'Assign Task', onClick: noop },
        { label: 'Issue DC', disabled: true, title: 'PO is not approved yet', onClick: noop },
        { label: 'Cancel PO', danger: true, onClick: noop },
      ]}
    />
  </Opened>
);

export const CustomLabel = () => (
  <ActionMenu label="Print" icon="printer" items={[{ label: 'Job Card', onClick: noop }, { label: 'Route Card', onClick: noop }]} />
);
