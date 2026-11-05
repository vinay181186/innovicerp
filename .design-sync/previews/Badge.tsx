import { Badge } from '@innovic/web';

export const Tones = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Badge>Standard</Badge>
    <Badge tone="blue">RM</Badge>
    <Badge tone="green">In Stock</Badge>
    <Badge tone="amber">TPI</Badge>
    <Badge tone="orange">OSP</Badge>
    <Badge tone="red">On Hold</Badge>
    <Badge tone="cyan">In-house</Badge>
    <Badge tone="teal">Consumable</Badge>
    <Badge tone="purple">JW</Badge>
  </div>
);

export const PrTypeMarkers = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Badge tone="blue" title="Raw material purchase">RM</Badge>
    <Badge tone="teal" title="Consumable purchase">Consumable</Badge>
    <Badge tone="purple" title="Service request">SVC</Badge>
  </div>
);

export const OperationTypes = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Badge tone="cyan">In-house</Badge>
    <Badge tone="orange" title="Outside Processing">OSP</Badge>
    <Badge tone="purple" title="Job Work order">JW</Badge>
  </div>
);
