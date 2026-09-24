import * as React from 'react';
/** Shop-floor machine tile (Op Entry grid, 140px track): code, name, 🟢 Running / ⚪ Idle, JC + CODE/REV + op. */
export interface MachineCardProps {
  code: string;
  name: string;
  running?: boolean;
  jobCard?: string;
  /** CODE/REV of the part on the machine */
  itemCode?: string;
  /** e.g. "Op10: CNC Turning" */
  operation?: string;
  selected?: boolean;
  onSelect?: () => void;
}
export declare function MachineCard(props: MachineCardProps): React.JSX.Element;
