import { MachineCard } from '@innovic/web';

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 8,
  width: 480,
} as const;

export const Running = () => (
  <div style={{ width: 180 }}>
    <MachineCard
      code="VMC-01"
      name="Vertical Machining Centre"
      running
      jobCard="IN-JC-00456"
      itemCode="BRKT-101/A"
      itemTitle="Mounting Bracket, MS Plate 10 mm"
      operation="Op20: VMC Milling"
    />
  </div>
);

export const Idle = () => (
  <div style={{ width: 180 }}>
    <MachineCard code="CNC-03" name="CNC Turning Centre" />
  </div>
);

export const Selected = () => (
  <div style={{ width: 180 }}>
    <MachineCard
      code="CNC-02"
      name="CNC Turning Centre"
      running
      selected
      onSelect={() => {}}
      jobCard="IN-JC-00461"
      itemCode="SHFT-204/C"
      operation="Op10: CNC Turning"
    />
  </div>
);

export const ShopFloor = () => (
  <div style={grid}>
    <MachineCard
      code="VMC-01"
      name="Vertical Machining Centre"
      running
      jobCard="IN-JC-00456"
      itemCode="BRKT-101/A"
      operation="Op20: VMC Milling"
    />
    <MachineCard
      code="CNC-02"
      name="CNC Turning Centre"
      running
      jobCard="IN-JC-00461"
      itemCode="SHFT-204/C"
      operation="Op10: CNC Turning"
    />
    <MachineCard code="SRG-01" name="Surface Grinder" />
  </div>
);
