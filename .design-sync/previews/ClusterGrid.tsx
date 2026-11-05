import { Cluster, ClusterFact, ClusterGrid, FormField, Input, Select } from '@innovic/web';

export const DetailView = () => (
  <ClusterGrid stack>
    <Cluster name="Against">
      <ClusterFact label="GRN Type" value="Against PO" />
      <ClusterFact num label="PO No." value="IN-PO-00418" />
      <ClusterFact num label="GRN Date" value="03-11-2026" />
      <ClusterFact num empty label="DC No." value="—" />
    </Cluster>
    <Cluster name="Vendor">
      <ClusterFact label="Vendor" value="Sample Heat Treat Works" />
      <ClusterFact num label="Vendor Code" value="VND-012" />
      <ClusterFact span={2} wrap label="Vendor Address" value="Plot 14, GIDC Phase II, Vatva, Ahmedabad, Gujarat 382445" />
    </Cluster>
    <Cluster name="This receipt">
      <ClusterFact num label="PO Qty" value="100" />
      <ClusterFact num label="Received Earlier" value="40" />
      <ClusterFact num label="Received" value="35" />
      <ClusterFact num lead label="To Receive" value="25" />
    </Cluster>
  </ClusterGrid>
);

export const CreateForm = () => (
  <ClusterGrid>
    <Cluster name="Order">
      <FormField label="Customer" required>
        <Select options={['Sample Engineering Pvt Ltd', 'Demo Pumps Ltd']} />
      </FormField>
      <FormField label="Client PO No." required>
        <Input defaultValue="PO/26/7781" />
      </FormField>
      <FormField label="Internal SO No.">
        <Input defaultValue="SO-2041" />
      </FormField>
      <FormField label="SO Date" required>
        <Input defaultValue="03-11-2026" />
      </FormField>
    </Cluster>
    <Cluster name="Schedule">
      <FormField label="Due Date" required>
        <Input defaultValue="28-11-2026" />
      </FormField>
      <FormField label="Payment Terms">
        <Select options={['30 days', '45 days', 'Advance']} />
      </FormField>
      <ClusterFact num label="Line Count" value="4" />
      <ClusterFact num lead label="Order Value" value="1,24,500.00" />
    </Cluster>
  </ClusterGrid>
);
