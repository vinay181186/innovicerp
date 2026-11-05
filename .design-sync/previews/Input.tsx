import { Input } from '@innovic/web';

const column = { display: 'flex', flexDirection: 'column', gap: 8, width: 224 } as const;

export const Kinds = () => (
  <div style={column}>
    <Input placeholder="Enter item name" />
    <Input defaultValue="Mounting Bracket" />
    <Input mono defaultValue="BRKT-101/A" />
    <Input type="date" defaultValue="2026-11-03" />
    <Input type="number" mono defaultValue={50} />
  </div>
);

export const States = () => (
  <div style={column}>
    <Input mono state="ok" defaultValue="IN-SO-00123" />
    <Input mono state="bad" defaultValue="IN-SO-00118" />
    <Input state="derived" readOnly defaultValue="Sample Engineering Pvt Ltd" />
    <Input disabled defaultValue="Locked after approval" />
  </div>
);

export const OffGridWidths = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Input fieldWidth="xs" mono defaultValue="50" />
    <Input fieldWidth="sm" mono defaultValue="420.00" />
    <Input fieldWidth="md" mono defaultValue="BRKT-101/A" />
    <Input fieldWidth="lg" defaultValue="Sample Engineering Pvt Ltd" />
  </div>
);
