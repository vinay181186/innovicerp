import { Cluster, ClusterFact, ClusterGrid, DocIdent, IdentCode, IdentSep } from '@innovic/web';

export const ReceiptIdentity = () => (
  <DocIdent>
    <IdentCode>IN-GRN-00142</IdentCode>
    <IdentSep />
    <span>Against PO</span>
    <IdentSep />
    <IdentCode>IN-PO-00418</IdentCode>
    <IdentSep />
    <span>Sample Heat Treat Works</span>
  </DocIdent>
);

export const SoLineIdentity = () => (
  <DocIdent>
    <IdentCode>IN-SO-00123</IdentCode>
    <IdentSep />
    <span>POL 20</span>
    <IdentSep />
    <IdentCode>BRKT-101/A</IdentCode>
    <IdentSep />
    <span>Mounting Bracket</span>
  </DocIdent>
);

export const AboveTheGrid = () => (
  <>
    <DocIdent>
      <IdentCode>IN-JC-00917</IdentCode>
      <IdentSep />
      <IdentCode>IN-SO-00123</IdentCode>
      <IdentSep />
      <span>Sample Engineering Pvt Ltd</span>
    </DocIdent>
    <ClusterGrid stack>
      <Cluster name="Quantity">
        <ClusterFact num label="JC Qty" value="40" />
        <ClusterFact num label="Produced" value="25" />
        <ClusterFact num label="Rejected" value="1" />
        <ClusterFact num lead label="Pending" value="14" />
      </Cluster>
    </ClusterGrid>
  </>
);
