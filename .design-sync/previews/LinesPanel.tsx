import { DocCard, LinesPanel, StatusBadge } from '@innovic/web';

export const InsideACard = () => (
  <DocCard
    accent="var(--blue)"
    expanded
    onToggle={() => {}}
    code="IN-SO-00123"
    title="Sample Engineering Pvt Ltd"
    badges={<StatusBadge kind="so" status="open" />}
  >
    <LinesPanel code="IN-SO-00123" onOpenDetail={() => {}}>
      <table className="innovic-table tbl-compact">
        <thead>
          <tr><th>POL</th><th>Item Code</th><th>Item Name</th><th>Order Qty</th></tr>
        </thead>
        <tbody>
          <tr><td>10</td><td className="td-code">BRKT-101/A</td><td>Mounting Bracket</td><td>120</td></tr>
          <tr><td>20</td><td className="td-code">SHFT-220/B</td><td>Pinion Shaft</td><td>40</td></tr>
        </tbody>
      </table>
    </LinesPanel>
  </DocCard>
);

export const Operations = () => (
  <LinesPanel title="OPERATIONS" code="IN-JC-00917">
    <table className="innovic-table tbl-compact">
      <thead>
        <tr><th>Op</th><th>Operation</th><th>Produced</th><th>Pending</th></tr>
      </thead>
      <tbody>
        <tr><td>10</td><td>CNC Turning</td><td>40</td><td>0</td></tr>
        <tr><td>20</td><td>VMC Milling</td><td>25</td><td>15</td></tr>
      </tbody>
    </table>
  </LinesPanel>
);
