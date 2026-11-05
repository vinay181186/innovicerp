import { ProgressBar } from '@innovic/web';

const row = {
  display: 'grid',
  gridTemplateColumns: '110px 1fr 40px',
  gap: 8,
  alignItems: 'center',
  fontSize: 'var(--fs-sm)',
} as const;

export const JobCardProgress = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 360 }}>
    <div style={row}>
      <span className="mono">IN-JC-00456</span>
      <ProgressBar value={25} label="IN-JC-00456 completed" />
      <span className="mono">25%</span>
    </div>
    <div style={row}>
      <span className="mono">IN-JC-00461</span>
      <ProgressBar value={60} color="var(--amber)" label="IN-JC-00461 completed" />
      <span className="mono">60%</span>
    </div>
    <div style={row}>
      <span className="mono">IN-JC-00470</span>
      <ProgressBar value={100} color="var(--green)" label="IN-JC-00470 completed" />
      <span className="mono">100%</span>
    </div>
  </div>
);

export const MachineUtilisation = () => (
  <div style={{ width: 360, fontSize: 'var(--fs-sm)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span className="mono fw-700">VMC-01</span>
      <span className="mono">82%</span>
    </div>
    <ProgressBar value={82} height={10} color="var(--green)" label="VMC-01 utilisation" />
  </div>
);

export const NotStarted = () => (
  <div style={{ width: 360, fontSize: 'var(--fs-sm)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span>QC coverage — not started</span>
      <span className="mono">0%</span>
    </div>
    <ProgressBar value={0} label="QC coverage" />
  </div>
);
