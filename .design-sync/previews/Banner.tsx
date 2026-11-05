import { Banner, Tag } from '@innovic/web';

export const Tones = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Banner flush tone="info">This Sales Order was raised from Planning on 03-11-2026.</Banner>
    <Banner flush tone="warn">3 lines have no rate. Add them before sending for approval.</Banner>
    <Banner flush tone="error" role="alert">Could not save: Client PO No. 4500123 is already used on IN-SO-00118.</Banner>
    <Banner flush tone="success">IN-SO-00123 approved on 03-11-2026 at 02:35 PM.</Banner>
  </div>
);

export const TitleAndDetail = () => (
  <Banner flush tone="warn" title="Edit waiting for approval">
    Qty on line 2 changes from 50 to 60 once the approver accepts it.
  </Banner>
);

export const DocumentAccent = () => (
  <Banner
    flush
    accent
    tone="info"
    title={
      <>
        Rework of <Tag>IN-JC-00456</Tag>
      </>
    }
  >
    12 NOS of BRKT-101/A returned from QC on 03-11-2026 for re-turning.
  </Banner>
);

export const Dismissible = () => (
  <Banner flush tone="info" onDismiss={() => {}}>
    Stock for BRKT-101/A was updated by Store while this page was open.
  </Banner>
);
