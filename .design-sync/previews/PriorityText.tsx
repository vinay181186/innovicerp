import { PriorityText } from '@innovic/web';

export const Levels = () => (
  <div style={{ display: 'flex', gap: 16, fontSize: 'var(--fs-sm)' }}>
    <PriorityText priority="urgent" />
    <PriorityText priority="high" />
    <PriorityText priority="normal" />
    <PriorityText priority="low" />
  </div>
);

export const OnTaskRows = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 340, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
      <span>Rework BRKT-101/A for IN-SO-00123</span>
      <PriorityText priority="urgent" />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
      <span>Update Route Card for SHFT-220/B</span>
      <PriorityText priority="normal" />
    </div>
  </div>
);
