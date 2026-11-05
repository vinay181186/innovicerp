import { Button } from '@innovic/web';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Button variant="ghost">Cancel</Button>
    <Button variant="primary">Save SO</Button>
    <Button variant="success">Approve</Button>
    <Button variant="danger">Cancel Order</Button>
  </div>
);

export const Small = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Button size="sm" variant="ghost">Export</Button>
    <Button size="sm" variant="primary">+ New SO</Button>
  </div>
);

export const States = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Button variant="primary" loading>Save SO</Button>
    <Button variant="primary" disabled title="Pick a Customer first">Save SO</Button>
  </div>
);
