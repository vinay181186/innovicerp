import { CheckField } from '@innovic/web';

const column = { display: 'flex', flexDirection: 'column', gap: 8 } as const;

export const Checkboxes = () => (
  <div style={column}>
    <CheckField defaultChecked label="Third-party inspection required" />
    <CheckField label="Material test certificate required" />
  </div>
);

export const RadioGroup = () => (
  <div style={column}>
    <CheckField type="radio" name="grn-type" value="po" defaultChecked label="Against Purchase Order" />
    <CheckField type="radio" name="grn-type" value="direct" label="Direct Purchase" />
    <CheckField type="radio" name="grn-type" value="party" label="Party GRN" />
  </div>
);

export const Disabled = () => (
  <div style={column}>
    <CheckField disabled defaultChecked label="QC done (locked after approval)" />
    <CheckField disabled label="Dispatch done" />
  </div>
);
