import { useEffect, useRef, type ReactNode } from 'react';
import { RowActions } from '@innovic/web';

const hashLink = ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
  <a href={`#${to}`} {...rest}>{children}</a>
);

/** The ⋯ opens on hover or click; click it once so the card shows the real menu. */
const Opened = ({ children }: { children: ReactNode }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.row-menu-btn')?.click();
  }, []);
  return <div ref={box} style={{ minHeight: 230 }}>{children}</div>;
};

const items = [
  { key: 'print', label: 'Print', icon: 'printer' as const, onSelect: () => {} },
  { key: 'plan', label: 'Create Plan', group: 'workflow' as const, onSelect: () => {} },
  { key: 'close', label: 'Short Close', group: 'workflow' as const, disabledReason: 'JC running', onSelect: () => {} },
  { key: 'assign', label: 'Assign Task', group: 'assign' as const, onSelect: () => {} },
];

export const RowMenuClosed = () => (
  <RowActions viewTo="/sales-orders/123" editTo="/sales-orders/123/edit" renderLink={hashLink} onDelete={() => {}} />
);

export const RowMenuOpen = () => (
  <Opened>
    <RowActions
      viewTo="/sales-orders/123"
      editTo="/sales-orders/123/edit"
      renderLink={hashLink}
      items={items}
      onDelete={() => {}}
      deleteConfirm={{ message: 'IN-SO-00123 and its 4 lines.' }}
    />
  </Opened>
);

export const LabelledForLineTables = () => (
  <RowActions labelled viewTo="/items/101" editTo="/items/101/edit" renderLink={hashLink} onDelete={() => {}} />
);

export const LabelledDeleteBusy = () => (
  <RowActions labelled onView={() => {}} onEdit={() => {}} onDelete={() => {}} deleteDisabled />
);
