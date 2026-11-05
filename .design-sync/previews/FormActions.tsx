import { Button, FormActions } from '@innovic/web';

export const SaveAndCancel = () => (
  <FormActions>
    <Button variant="ghost">Cancel</Button>
    <Button variant="primary">Save SO</Button>
  </FormActions>
);

export const UnsavedWithDraft = () => (
  <FormActions dirty>
    <Button variant="ghost">Cancel</Button>
    <Button variant="ghost">Save as Draft</Button>
    <Button variant="primary">Save SO</Button>
  </FormActions>
);

export const SaveBlockedWithNote = () => (
  <FormActions note="Pick a Customer and add at least one line to save.">
    <Button variant="ghost">Cancel</Button>
    <Button variant="primary" disabled title="Pick a Customer first">Save SO</Button>
  </FormActions>
);

export const Saving = () => (
  <FormActions dirty>
    <Button variant="ghost" disabled>Cancel</Button>
    <Button variant="primary" loading>Save GRN</Button>
  </FormActions>
);
