import { FormField, FormGrid, Select } from '@innovic/web';

export const Uom = () => (
  <FormGrid>
    <FormField label="UOM" required size="full">
      <Select options={['NOS', 'KG', 'MTR', 'SET']} defaultValue="NOS" />
    </FormField>
  </FormGrid>
);

export const Placeholder = () => (
  <FormGrid>
    <FormField label="PR Type" required size="full">
      <Select
        placeholder="Select type…"
        defaultValue=""
        options={[
          { value: 'rm', label: 'Raw Material' },
          { value: 'consumable', label: 'Consumable' },
          { value: 'service', label: 'Service' },
        ]}
      />
    </FormField>
  </FormGrid>
);

export const WithError = () => (
  <FormGrid>
    <FormField label="GST Treatment" required size="full" error="Pick how GST applies to this customer.">
      <Select placeholder="Select…" defaultValue="" options={['CGST + SGST', 'IGST']} />
    </FormField>
  </FormGrid>
);

export const Disabled = () => (
  <FormGrid>
    <FormField label="Currency" size="full">
      <Select disabled options={['INR', 'USD']} defaultValue="INR" />
    </FormField>
  </FormGrid>
);

export const OffGrid = () => (
  <Select fieldWidth="sm" options={['All', 'Open', 'Closed']} defaultValue="Open" aria-label="SO Status" />
);
