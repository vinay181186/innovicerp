import type { ReactNode } from 'react';
import {
  ActionMenu,
  Button,
  Cluster,
  ClusterFact,
  ClusterGrid,
  DetailHeader,
  ReadField,
  ReadGrid,
  StatusBadge,
} from '@innovic/web';

const hashLink = ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
  <a href={`#${to}`} {...rest}>{children}</a>
);

export const SalesOrder = () => (
  <DetailHeader
    backLabel="Back to SO Master"
    backTo="/sales-orders"
    renderLink={hashLink}
    code="IN-SO-00123"
    name="Sample Engineering Pvt Ltd"
    badges={<StatusBadge kind="so" status="open" />}
    actions={
      <>
        <Button size="sm" variant="primary">Create Plan</Button>
        <ActionMenu
          items={[
            { label: 'Print', icon: 'printer', onClick: () => {} },
            { label: 'Edit', onClick: () => {} },
            { label: 'Cancel SO', danger: true, onClick: () => {} },
          ]}
        />
      </>
    }
  >
    <ClusterGrid stack>
      <Cluster name="Order">
        <ClusterFact num label="Client PO No." value="PO/26/7781" />
        <ClusterFact num label="Internal SO No." value="SO-2041" />
        <ClusterFact num label="SO Date" value="03-11-2026" />
        <ClusterFact num label="Due Date" value="28-11-2026" />
      </Cluster>
    </ClusterGrid>
  </DetailHeader>
);

export const VendorMaster = () => (
  <DetailHeader
    backLabel="Back to Vendor Master"
    onBack={() => {}}
    code="VND-012"
    name="Sample Heat Treat Works"
    badges={<StatusBadge kind="active" status="active" />}
    actions={<Button size="sm" variant="ghost">Edit</Button>}
  >
    <ReadGrid>
      <ReadField label="Contact Person" size="md" value="Ramesh Patel" />
      <ReadField label="Phone" size="md" mono value="+91 79 2583 0000" />
      <ReadField label="GSTIN" size="md" mono value="24AAAAA0000A1Z5" />
      <ReadField label="Vendor Address" size="full" value="Plot 14, GIDC Phase II, Vatva, Ahmedabad, Gujarat 382445" />
    </ReadGrid>
  </DetailHeader>
);

export const HeaderOnly = () => (
  <DetailHeader
    code="IN-GRN-00142"
    name="Sample Heat Treat Works"
    badges={<StatusBadge kind="grnqc" status="pending" />}
  />
);
