import { TabStrip } from '@innovic/web';

export const TaskBoard = () => (
  <TabStrip
    label="Task views"
    activeKey="inbox"
    onChange={() => {}}
    tabs={[
      { key: 'inbox', label: 'Inbox', count: 8 },
      { key: 'outbox', label: 'Outbox', count: 3 },
      { key: 'todo', label: 'My To-Do', count: 0 },
      { key: 'all', label: 'All Tasks', note: '(Admin)' },
    ]}
  />
);

export const JobCardViews = () => (
  <TabStrip
    label="Job Card views"
    activeKey="ops"
    onChange={() => {}}
    tabs={[
      { key: 'ops', label: 'Operations' },
      { key: 'qty', label: 'Qty Flow' },
      { key: 'rm', label: 'Raw Material' },
      { key: 'history', label: 'History' },
    ]}
  />
);

export const CountStillLoading = () => (
  <TabStrip
    activeKey="waiting"
    onChange={() => {}}
    tabs={[
      { key: 'waiting', label: 'Waiting', count: null },
      { key: 'approved', label: 'Approved', count: 12 },
      { key: 'rejected', label: 'Rejected', count: 1 },
    ]}
  />
);
