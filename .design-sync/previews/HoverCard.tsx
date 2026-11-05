import { HoverCard, QtyStrip } from '@innovic/web';
import { useEffect, useRef, type ReactNode } from 'react';

const breakdown = (
  <QtyStrip
    items={[
      { label: 'RECEIVED', value: 120 },
      { label: 'ISSUED', value: 80, color: 'var(--green)' },
      { label: 'BALANCE', value: 40, color: 'var(--red)' },
    ]}
  />
);

// The card opens on hover; React's onMouseEnter listens for mouseover, so one
// synthetic event shows the open state in the card.
const OpenOnMount = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector('.hover-card-trigger')
      ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }, []);
  return (
    <div ref={ref} style={{ height: 150, fontSize: 'var(--fs-sm)' }}>
      {children}
    </div>
  );
};

export const Trigger = () => (
  <span style={{ fontSize: 'var(--fs-sm)' }}>
    Customer RM:{' '}
    <HoverCard title="BRKT-101-RM — Customer RM" card={breakdown}>
      <b>Yes</b>
    </HoverCard>
  </span>
);

export const CardOpen = () => (
  <OpenOnMount>
    Customer RM:{' '}
    <HoverCard title="BRKT-101-RM — Customer RM" card={breakdown}>
      <b>Yes</b>
    </HoverCard>
  </OpenOnMount>
);
