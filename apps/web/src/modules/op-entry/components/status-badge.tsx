import type { ComputedJcOpStatus, RunningOpStatus } from '@innovic/shared';
import { OP_STATUS } from '@/modules/job-cards/lib/jc-op-labels';

// Op status wording + colour come from the ONE shared map the Job Card page
// uses (job-cards/lib/jc-op-labels.ts), so the same status never looks
// different on two screens (At Vendor used to be uncoloured here).
export function JcOpStatusBadge({ status }: { status: ComputedJcOpStatus }) {
  const s = OP_STATUS[status];
  return <span className={`badge ${s?.cls ?? ''}`.trim()}>{s?.label ?? status}</span>;
}

const RUNNING_BADGE: Record<RunningOpStatus, { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'b-green' },
  done: { label: 'Completed', cls: 'b-green' },
  stopped: { label: 'Stopped', cls: 'b-red' },
};

export function RunningOpStatusBadge({ status }: { status: RunningOpStatus }) {
  const s = RUNNING_BADGE[status];
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}
