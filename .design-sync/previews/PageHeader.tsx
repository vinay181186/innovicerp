import { Button, FormActions, PageHeader, TabStrip } from '@innovic/web';

export const CreateForm = () => (
  <PageHeader
    title="Create Sales Order"
    icon="📋"
    subtitle="Line items are added after the header is saved."
    backLabel="Back to SO Master"
    onBack={() => {}}
  />
);

export const UnsavedEdit = () => (
  <PageHeader
    title="Edit Sales Order"
    icon="📋"
    subtitle="IN-SO-00123 · Sample Engineering Pvt Ltd"
    backLabel="Back to SO Master"
    onBack={() => {}}
    dirty
    actions={<Button size="sm" variant="ghost">Print</Button>}
  />
);

export const SettingsWithTabs = () => (
  <PageHeader title="Approval Limits" icon="⚙️" subtitle="Who may approve which document, up to what amount.">
    <TabStrip
      activeKey="po"
      tabs={[
        { key: 'po', label: 'Purchase Orders', count: 6 },
        { key: 'so', label: 'Sales Orders', count: 3 },
        { key: 'jc', label: 'Job Cards' },
      ]}
    />
  </PageHeader>
);

export const WithBottomSave = () => (
  <>
    <PageHeader title="Create GRN" icon="📦" backLabel="Back to GRN List" onBack={() => {}} />
    <FormActions>
      <Button variant="ghost">Cancel</Button>
      <Button variant="primary">Save GRN</Button>
    </FormActions>
  </>
);
