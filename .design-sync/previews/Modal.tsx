import { Banner, Button, FormField, FormGrid, Input, Modal, Select, Textarea } from '@innovic/web';

const noop = () => {};

export const FormPopup = () => (
  <Modal
    inline
    size="sm"
    title="Short Close Line 2"
    onClose={noop}
    footer={
      <>
        <Button size="sm" variant="ghost">Cancel</Button>
        <Button size="sm" variant="primary">Save</Button>
      </>
    }
  >
    <FormGrid>
      <FormField label="Item Code" size="lg">
        <Input mono value="BRKT-101/A" readOnly state="derived" />
      </FormField>
      <FormField label="Short Close Qty" required size="lg">
        <Input mono type="number" defaultValue={10} />
      </FormField>
      <FormField label="Reason" required size="full">
        <Textarea defaultValue="Customer revised the requirement to 40 NOS." />
      </FormField>
    </FormGrid>
  </Modal>
);

export const ViewOnly = () => (
  <Modal inline size="sm" title="IN-SO-00123 · Line 1" onClose={noop} confirmExit={false}>
    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text2)' }}>
      Sample Engineering Pvt Ltd ordered 50 NOS of BRKT-101/A, due 03-11-2026.
    </div>
  </Modal>
);

export const HeaderActions = () => (
  <Modal
    inline
    size="sm"
    title="Plan RM for IN-JC-00456"
    onClose={noop}
    headerActions={<Button size="sm" variant="ghost">Print</Button>}
    footer={<Button size="sm" variant="primary">Save</Button>}
  >
    <FormGrid>
      <FormField label="UOM" size="md">
        <Select options={['KG', 'NOS', 'MTR']} defaultValue="KG" />
      </FormField>
      <FormField label="RM Qty" size="md">
        <Input mono defaultValue="12.500" />
      </FormField>
      <FormField label="RM Grade" size="md">
        <Input defaultValue="EN8" />
      </FormField>
    </FormGrid>
  </Modal>
);

export const WithNotice = () => (
  <Modal
    inline
    size="sm"
    title="Send PO IN-MPO-00311 for approval"
    onClose={noop}
    footer={<Button size="sm" variant="primary">Send</Button>}
  >
    <Banner flush tone="warn">PO value is above your approval limit. It goes to the Purchase Manager.</Banner>
  </Modal>
);
