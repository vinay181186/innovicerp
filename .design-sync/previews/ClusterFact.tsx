import { Badge, Cluster, ClusterFact, ClusterGrid } from '@innovic/web';

export const ReadOnlyFacts = () => (
  <ClusterGrid stack>
    <Cluster name="Line">
      <ClusterFact num label="Item Code" value="BRKT-101/A" />
      <ClusterFact label="Item Name" value="Mounting Bracket" />
      <ClusterFact num label="POL" value="20" />
      <ClusterFact num label="Order Qty" value="120" />
    </Cluster>
  </ClusterGrid>
);

export const LeadResult = () => (
  <ClusterGrid stack>
    <Cluster name="This receipt">
      <ClusterFact num label="PO Qty" value="100" />
      <ClusterFact num label="Received Earlier" value="40" />
      <ClusterFact num label="Received" value="35" />
      <ClusterFact num lead label="To Receive" value="25" />
    </Cluster>
  </ClusterGrid>
);

export const EmptyWrapAndChip = () => (
  <ClusterGrid stack>
    <Cluster name="Vendor paper">
      <ClusterFact
        num
        label="Vendor Invoice No."
        value="INV-5521"
        after={<Badge tone="amber">→ INV-5522</Badge>}
      />
      <ClusterFact num empty label="Vendor Challan No." value="—" />
      <ClusterFact
        span={2}
        wrap
        label="GRN Remarks"
        value="Two boxes received with torn wrapping; contents checked and counted at the gate."
      />
    </Cluster>
  </ClusterGrid>
);
