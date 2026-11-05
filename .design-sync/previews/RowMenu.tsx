import { RowMenu, type RowMenuItem } from '@innovic/web';
import { useEffect, useRef, type ReactNode } from 'react';

const items: RowMenuItem[] = [
  { key: 'view', label: 'View', icon: 'eye', onSelect: () => {} },
  { key: 'edit', label: 'Edit', icon: 'pencil', onSelect: () => {} },
  { key: 'print', label: 'Print', icon: 'printer', onSelect: () => {} },
  { key: 'plan', label: 'Create Plan', group: 'workflow', icon: 'play', onSelect: () => {} },
  { key: 'dispatch', label: 'Dispatch', group: 'workflow', disabledReason: 'No stock yet' },
  { key: 'cancel', label: 'Cancel SO', group: 'danger', icon: 'trash-2', onSelect: () => {} },
];

// The menu opens on a click, so the card clicks the ⋯ once to show the open state.
const OpenOnMount = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.click();
  }, []);
  return (
    <div ref={ref} style={{ height: 300, paddingLeft: 8 }}>
      {children}
    </div>
  );
};

export const Closed = () => <RowMenu items={items} label="Actions for IN-SO-00123" />;

export const OpenMenu = () => (
  <OpenOnMount>
    <RowMenu items={items} label="Actions for IN-SO-00123" />
  </OpenOnMount>
);
