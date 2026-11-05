import { FormField, FormGrid, Textarea } from '@innovic/web';

export const Remarks = () => (
  <FormGrid>
    <FormField label="Remarks" size="full">
      <Textarea defaultValue="Deliver with material test certificate. Pack in wooden crates." />
    </FormField>
  </FormGrid>
);

export const Empty = () => (
  <FormGrid>
    <FormField label="Shipping Address" required size="full">
      <Textarea rows={3} placeholder="Enter the full address with PIN code" />
    </FormField>
  </FormGrid>
);

export const WithError = () => (
  <FormGrid>
    <FormField label="Cancel Reason" required size="full" error="Enter why this Sales Order is being cancelled.">
      <Textarea />
    </FormField>
  </FormGrid>
);

export const Disabled = () => (
  <FormGrid>
    <FormField label="QC Remarks" size="full">
      <Textarea disabled defaultValue="Accepted on 03-11-2026 with minor burr removal." />
    </FormField>
  </FormGrid>
);
