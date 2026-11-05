import { Button, DocCard, LinesPanel, QtyStrip, StatusBadge } from '@innovic/web';

const qty = (received: number, accepted: number, rejected: number) => (
  <QtyStrip
    items={[
      { label: 'Received', value: received },
      { label: 'Accepted', value: accepted, color: 'var(--green)' },
      { label: 'Rejected', value: rejected, color: 'var(--red2)' },
    ]}
  />
);

export const QcWaiting = () => (
  <DocCard
    accent="var(--amber)"
    onToggle={() => {}}
    onOpen={() => {}}
    code="IN-GRN-00142"
    title="Sample Heat Treat Works"
    badges={<StatusBadge kind="grnqc" status="pending" />}
    actions={<Button size="sm" variant="ghost">Assign</Button>}
    metrics={qty(60, 0, 0)}
    meta={['03-11-2026', 'IN-PO-00418', 'DC 4471']}
  />
);

export const LateOrder = () => (
  <DocCard
    accent="var(--red)"
    onToggle={() => {}}
    code="IN-SO-00123"
    title="Sample Engineering Pvt Ltd"
    badges={<StatusBadge kind="so" status="open" />}
    meta={['Due 28-10-2026', 'PO/26/7781', '4 lines']}
  />
);

export const ExpandedWithLines = () => (
  <DocCard
    accent="var(--green)"
    expanded
    onToggle={() => {}}
    code="IN-GRN-00138"
    title="Demo Castings Ltd"
    badges={<StatusBadge kind="grnqc" status="completed" />}
    metrics={qty(35, 34, 1)}
    meta={['29-10-2026', 'IN-PO-00402']}
  >
    <LinesPanel code="IN-GRN-00138" onOpenDetail={() => {}}>
      <table className="innovic-table tbl-compact">
        <thead>
          <tr><th>Item Code</th><th>Item Name</th><th>Received</th><th>Accepted</th></tr>
        </thead>
        <tbody>
          <tr><td className="td-code">BRKT-101/A</td><td>Mounting Bracket</td><td>20</td><td>20</td></tr>
          <tr><td className="td-code">SHFT-220/B</td><td>Pinion Shaft</td><td>15</td><td>14</td></tr>
        </tbody>
      </table>
    </LinesPanel>
  </DocCard>
);
