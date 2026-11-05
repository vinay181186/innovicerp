import { ReadField, ReadGrid } from '@innovic/web';

export const Sizes = () => (
  <ReadGrid>
    <ReadField label="UOM" size="xs" value="Nos" />
    <ReadField label="Order Qty" size="sm" mono value="120" />
    <ReadField label="Client PO No." size="md" mono value="PO/26/7781" />
    <ReadField label="SO Date" size="sm" mono value="03-11-2026" />
    <ReadField label="Customer" size="lg" value="Sample Engineering Pvt Ltd" />
    <ReadField label="Contact Person" size="lg" value="Ramesh Patel" />
  </ReadGrid>
);

export const EmptyValue = () => (
  <ReadGrid>
    <ReadField label="Item Code" size="md" mono value="BRKT-101/A" />
    <ReadField label="Item Name" size="md" value="Mounting Bracket" />
    <ReadField label="Vendor Challan No." size="md" mono />
  </ReadGrid>
);

export const KeptLineBreaks = () => (
  <ReadGrid>
    <ReadField
      label="Customer Address"
      size="full"
      pre
      value={'Sample Engineering Pvt Ltd\nPlot 22, Industrial Estate\nRajkot, Gujarat 360003'}
    />
  </ReadGrid>
);
