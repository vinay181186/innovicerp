import { FormGrid, LineItemPicker } from '@innovic/web';

const items = [
  { id: 'i1', code: 'BRKT-101/A', name: 'Mounting Bracket', material: 'EN8' },
  { id: 'i2', code: 'SHFT-220/B', name: 'Drive Shaft', material: 'SS304' },
];

const noop = () => {};

export const MatchedItem = () => (
  <FormGrid>
    <LineItemPicker code="BRKT-101/A" name="Mounting Bracket" items={items} onChange={noop} />
  </FormGrid>
);

export const OffMaster = () => (
  <FormGrid>
    <LineItemPicker code="GSKT-900" name="Flange Gasket 50 NB" items={items} onChange={noop} />
  </FormGrid>
);

export const NameMissing = () => (
  <FormGrid>
    <LineItemPicker code="GSKT-900" name="" items={items} nameError="Enter the Item Name." onChange={noop} />
  </FormGrid>
);

export const QcLocked = () => (
  <FormGrid>
    <LineItemPicker code="SHFT-220/B" name="Drive Shaft" items={items} readOnly onChange={noop} />
  </FormGrid>
);
