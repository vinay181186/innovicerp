import { Button, FilterBar } from '@innovic/web';

export const TaskFilters = () => (
  <FilterBar
    placeholder="Search tasks, SO No., item…"
    onSearch={() => {}}
    filters={[
      { key: 'status', options: ['All Status', 'To Do', 'In Progress', 'Done'] },
      { key: 'priority', options: ['All Priority', 'High', 'Medium', 'Low'] },
      { key: 'by', options: ['Assigned By: All', 'Planning', 'Purchase'] },
      { key: 'due', options: ['Due Date: All', 'Today', 'This Week', 'Overdue'] },
    ]}
  />
);

export const FilterOnWithReset = () => (
  <FilterBar
    search="BRKT-101/A"
    onSearch={() => {}}
    placeholder="Search store transactions…"
    filters={[
      {
        key: 'type',
        value: 'issue',
        onChange: () => {},
        label: 'Transaction Type',
        options: [
          { value: '', label: 'All Types' },
          { value: 'issue', label: 'Issue' },
          { value: 'receipt', label: 'Receipt' },
        ],
      },
    ]}
  >
    <Button size="sm" variant="ghost">Clear Filters</Button>
  </FilterBar>
);

export const DisabledFilter = () => (
  <FilterBar
    onSearch={() => {}}
    placeholder="Search GRN No., vendor…"
    filters={[
      { key: 'vendor', options: ['All Vendors'], disabled: true, label: 'Vendor' },
      { key: 'qc', options: ['All QC Status', 'QC Pending', 'Completed'] },
    ]}
  />
);
