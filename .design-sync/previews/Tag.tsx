import { Tag } from '@innovic/web';

export const LinkedDocuments = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Tag onClick={() => {}} title="Open Sales Order">IN-SO-00123</Tag>
    <Tag onClick={() => {}} title="Open Job Card">IN-JC-00456</Tag>
    <Tag onClick={() => {}} title="Open Purchase Order">IN-MPO-00311</Tag>
  </div>
);

export const Uom = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Tag tone="neutral">NOS</Tag>
    <Tag tone="neutral">KG</Tag>
    <Tag tone="neutral">MTR</Tag>
  </div>
);

export const Revisions = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Tag tone="rev">Rev A</Tag>
    <Tag tone="rev">Rev B</Tag>
    <Tag tone="rev">Rev 1</Tag>
  </div>
);

export const OnAnItemRow = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
    <span className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>BRKT-101/A</span>
    <Tag tone="rev">Rev B</Tag>
    <Tag tone="neutral">NOS</Tag>
    <Tag onClick={() => {}}>IN-SO-00123</Tag>
  </div>
);
