import { Cluster, ClusterFact, ClusterGrid } from '@innovic/web';

export const NamedRows = () => (
  <ClusterGrid stack>
    <Cluster name="Against">
      <ClusterFact label="GRN Type" value="Against PO" />
      <ClusterFact num label="PO No." value="IN-PO-00418" />
      <ClusterFact num label="GRN Date" value="03-11-2026" />
      <ClusterFact num label="DC No." empty value="—" />
    </Cluster>
    <Cluster name="Vendor">
      <ClusterFact label="Vendor" value="Sample Heat Treat Works" />
      <ClusterFact num label="Vendor Code" value="VND-012" />
      <ClusterFact span={2} wrap label="Vendor Address" value="Plot 14, GIDC Phase II, Vatva, Ahmedabad, Gujarat 382445" />
    </Cluster>
  </ClusterGrid>
);

export const WideEightFacts = () => (
  <ClusterGrid stack>
    <Cluster name="Order" wide>
      <ClusterFact num label="SO No." value="IN-SO-00123" />
      <ClusterFact num label="Internal SO No." value="SO-2041" />
      <ClusterFact label="Customer" value="Sample Engineering Pvt Ltd" />
      <ClusterFact num label="Client PO No." value="PO/26/7781" />
      <ClusterFact num label="SO Date" value="03-11-2026" />
      <ClusterFact num label="Due Date" value="28-11-2026" />
      <ClusterFact label="Payment Terms" value="30 days" />
      <ClusterFact num label="Line Count" value="4" />
    </Cluster>
  </ClusterGrid>
);

export const ContinuationRow = () => (
  <ClusterGrid>
    <Cluster name="Quantity">
      <ClusterFact num label="Order Qty" value="120" />
      <ClusterFact num label="Planned" value="120" />
      <ClusterFact num label="Produced" value="80" />
      <ClusterFact num label="Rejected" value="2" />
    </Cluster>
    <Cluster name={null}>
      <ClusterFact num label="Dispatched" value="60" />
      <ClusterFact num label="In Store" value="18" />
      <ClusterFact num label="Reworked" value="4" />
      <ClusterFact num lead label="To Dispatch" value="60" />
    </Cluster>
  </ClusterGrid>
);
