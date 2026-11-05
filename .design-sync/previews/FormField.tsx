import { FormField, FormGrid, Input, Select } from '@innovic/web';

export const Required = () => (
  <FormGrid>
    <FormField label="Customer" required size="full">
      <Input defaultValue="Sample Engineering Pvt Ltd" />
    </FormField>
  </FormGrid>
);

export const WithHelp = () => (
  <FormGrid>
    <FormField label="Client PO No." size="full" help="The customer's own PO number, as printed on their order.">
      <Input mono defaultValue="PO-4500123" />
    </FormField>
  </FormGrid>
);

export const WithError = () => (
  <FormGrid>
    <FormField label="Order Qty" required size="full" error="Order Qty cannot be more than the 40 NOS left on this plan.">
      <Input mono state="bad" defaultValue="60" />
    </FormField>
  </FormGrid>
);

export const WithSelect = () => (
  <FormGrid>
    <FormField label="UOM" required size="full">
      <Select options={['NOS', 'KG', 'MTR']} defaultValue="NOS" />
    </FormField>
  </FormGrid>
);
