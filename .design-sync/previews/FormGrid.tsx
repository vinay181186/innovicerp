import { FormField, FormGrid, Input, Select, Textarea } from '@innovic/web';

export const SalesOrderHeader = () => (
  <FormGrid>
    <FormField label="Customer" required size="lg">
      <Input defaultValue="Sample Engineering Pvt Ltd" />
    </FormField>
    <FormField label="SO No." size="sm">
      <Input mono defaultValue="IN-SO-00123" readOnly state="derived" />
    </FormField>
    <FormField label="SO Date" required size="sm">
      <Input type="date" defaultValue="2026-11-03" />
    </FormField>
    <FormField label="Client PO No." required size="md">
      <Input mono defaultValue="PO-4500123" />
    </FormField>
    <FormField label="Currency" size="md">
      <Select options={['INR', 'USD', 'EUR']} defaultValue="INR" />
    </FormField>
    <FormField label="Delivery Date" size="md">
      <Input type="date" defaultValue="2026-12-15" />
    </FormField>
    <FormField label="Remarks" size="full">
      <Textarea defaultValue="Deliver with material test certificate." />
    </FormField>
  </FormGrid>
);

export const SizesByContent = () => (
  <FormGrid>
    <FormField label="Rev" size="xs">
      <Input mono defaultValue="B" />
    </FormField>
    <FormField label="Item Code" size="md">
      <Input mono defaultValue="BRKT-101/A" />
    </FormField>
    <FormField label="Order Qty" size="sm">
      <Input mono defaultValue="50" />
    </FormField>
    <FormField label="Rate" size="sm">
      <Input mono defaultValue="420.00" />
    </FormField>
    <FormField label="Item Name" size="lg">
      <Input defaultValue="Mounting Bracket" />
    </FormField>
    <FormField label="UOM" size="xs">
      <Input defaultValue="NOS" />
    </FormField>
    <FormField label="HSN Code" size="md">
      <Input mono defaultValue="7326" />
    </FormField>
  </FormGrid>
);
