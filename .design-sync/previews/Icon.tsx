import { ICON_NAMES, Icon } from '@innovic/web';

export const RowActions = () => (
  <div style={{ display: 'flex', gap: 14, alignItems: 'center', color: 'var(--text2)' }}>
    <Icon name="eye" title="View" />
    <Icon name="pencil" title="Edit" />
    <Icon name="printer" title="Print" />
    <Icon name="download" title="Export" />
    <Icon name="trash-2" title="Delete" color="var(--red)" />
  </div>
);

export const WithLabels = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-sm)', color: 'var(--text2)' }}>
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Icon name="truck" color="var(--text3)" /> Outsource to vendor
    </span>
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Icon name="play" color="var(--green)" /> Start Operation
    </span>
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Icon name="paperclip" color="var(--text3)" /> BRKT-101-A drawing.pdf
    </span>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--text)' }}>
    <Icon name="package" size={12} />
    <Icon name="package" size={13} />
    <Icon name="package" size={14} />
    <Icon name="package" size={15} />
  </div>
);

export const FullSet = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 22px)', gap: 8, color: 'var(--text2)' }}>
    {ICON_NAMES.map((name) => (
      <Icon key={name} name={name} title={name} />
    ))}
  </div>
);
