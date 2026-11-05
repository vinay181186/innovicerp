import { Panel, ReadField, ReadGrid } from '@innovic/web';

export const ItemMaster = () => (
  <Panel title="Item Details">
    <ReadGrid>
      <ReadField label="Item Code" size="md" mono value="BRKT-101/A" />
      <ReadField label="Item Name" size="lg" value="Mounting Bracket" />
      <ReadField label="UOM" size="xs" value="Nos" />
      <ReadField label="HSN Code" size="sm" mono value="73269099" />
      <ReadField label="Drawing Rev" size="sm" mono value="A" />
      <ReadField label="Item Group" size="lg" value="Fabricated Parts" />
      <ReadField label="Item Remarks" size="full" value="Zinc plated after machining. Customer drawing governs the hole pattern." />
    </ReadGrid>
  </Panel>
);

export const BlankFieldsAnswered = () => (
  <ReadGrid>
    <ReadField label="Vendor" size="lg" value="Sample Heat Treat Works" />
    <ReadField label="Email" size="lg" />
    <ReadField label="Vendor Code" size="md" mono value="VND-012" />
    <ReadField label="GSTIN" size="md" mono />
    <ReadField label="Phone" size="md" mono />
  </ReadGrid>
);
