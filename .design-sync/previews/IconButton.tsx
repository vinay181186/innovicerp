import { Icon, IconButton } from '@innovic/web';

export const RowActions = () => (
  <div style={{ display: 'flex', gap: 6 }}>
    <IconButton title="View" icon={<Icon name="eye" />} />
    <IconButton title="Edit" icon={<Icon name="pencil" />} />
    <IconButton title="Print" icon={<Icon name="printer" />} />
    <IconButton title="Delete" variant="danger" icon={<Icon name="trash-2" />} />
  </div>
);

export const Small = () => (
  <div style={{ display: 'flex', gap: 6 }}>
    <IconButton size="sm" title="Refresh" icon={<Icon name="refresh-cw" size={13} />} />
    <IconButton size="sm" title="Export" icon={<Icon name="download" size={13} />} />
    <IconButton size="sm" title="Close" icon={<Icon name="x" size={13} />} />
  </div>
);

export const States = () => (
  <div style={{ display: 'flex', gap: 6 }}>
    <IconButton title="Add line" variant="primary" icon={<Icon name="plus" />} />
    <IconButton title="Approve" variant="success" icon={<Icon name="check" />} />
    <IconButton title="Edit is locked after approval" disabled icon={<Icon name="pencil" />} />
  </div>
);
