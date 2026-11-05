import { StatusPills, ViewToggle } from '@innovic/web';

export const AllSelected = () => (
  <StatusPills options={['draft', 'open', 'closed', 'cancelled']} value={null} onChange={() => {}} />
);

export const OneActive = () => (
  <StatusPills
    options={[
      { value: 'pending', label: 'QC Pending' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'completed', label: 'Completed' },
    ]}
    value="pending"
    allLabel="All GRNs"
    label="Filter GRNs by QC status"
    onChange={() => {}}
  />
);

export const WithViewToggle = () => (
  <StatusPills
    options={['open', 'closed']}
    value="open"
    onChange={() => {}}
    right={<ViewToggle value="list" onChange={() => {}} />}
  />
);
