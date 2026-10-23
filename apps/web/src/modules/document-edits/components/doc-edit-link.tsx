// Where a staged edit's Doc No. opens — one entry per enrolled type. A full
// Record, so enrolling a new type without a link fails the typecheck (the same
// guard DOCUMENT_EDIT_LABEL / DOCUMENT_EDIT_FORM_KEY carry in @innovic/shared).
//
// Every `to` is a literal registered route (typed by the router). Types with a
// detail page open it by id; the ones with no detail page (Party GRN, Machine
// Group, Material Grade / Size, Instrument — edited in a modal) open their
// list, filtered to the code where that list reads `?search=`.

import type { DocumentEditEntity, DocumentEditRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

type LinkRender = (r: DocumentEditRow, props: LinkProps) => React.JSX.Element;
interface LinkProps {
  className: string;
  style: React.CSSProperties;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

const byId = (r: DocumentEditRow): { id: string } => ({ id: r.entityId });

export const DOCUMENT_EDIT_LINK: Readonly<Record<DocumentEditEntity, LinkRender>> = {
  PurchaseOrder: (r, p) => <Link to="/purchase-orders/$id" params={byId(r)} {...p} />,
  PurchaseRequest: (r, p) => <Link to="/purchase-requests/$id" params={byId(r)} {...p} />,
  NonConformance: (r, p) => <Link to="/nc-register/$id" params={byId(r)} {...p} />,
  Plan: (r, p) => <Link to="/plans/$id" params={byId(r)} {...p} />,
  SalesOrder: (r, p) => <Link to="/sales-orders/$id" params={byId(r)} {...p} />,
  JobWorkOrder: (r, p) => <Link to="/job-work-orders/$id" params={byId(r)} {...p} />,
  GoodsReceiptNote: (r, p) => <Link to="/goods-receipt-notes/$id" params={byId(r)} {...p} />,
  JobCard: (r, p) => <Link to="/job-cards/$id" params={byId(r)} {...p} />,
  Dispatch: (r, p) => <Link to="/customer-dispatches/$id" params={byId(r)} {...p} />,
  DeliveryChallan: (r, p) => <Link to="/delivery-challans/$id" params={byId(r)} {...p} />,
  PartyGrn: (r, p) => (
    <Link to="/party-grn" search={{ tab: 'receive', search: r.docCode }} {...p} />
  ),
  ProductionOrder: (r, p) => <Link to="/production-orders/$id" params={byId(r)} {...p} />,
  Item: (r, p) => <Link to="/items/$id" params={byId(r)} {...p} />,
  Vendor: (r, p) => <Link to="/vendors/$id" params={byId(r)} {...p} />,
  Client: (r, p) => <Link to="/clients/$id" params={byId(r)} {...p} />,
  Machine: (r, p) => <Link to="/machines/$id" params={byId(r)} {...p} />,
  MachineGroup: (_r, p) => <Link to="/machines" search={{ tab: 'groups' }} {...p} />,
  Operator: (r, p) => <Link to="/operators/$id" params={byId(r)} {...p} />,
  CostCenter: (r, p) => <Link to="/cost-centers/$id" params={byId(r)} {...p} />,
  TpiInspector: (r, p) => <Link to="/tpi-masters/$id" params={byId(r)} {...p} />,
  QcProcess: (r, p) => <Link to="/qc-processes/$id" params={byId(r)} {...p} />,
  MaterialGrade: (r, p) => <Link to="/raw-material" search={{ search: r.docCode }} {...p} />,
  MaterialSize: (r, p) => (
    <Link to="/raw-material" search={{ tab: 'size', search: r.docCode }} {...p} />
  ),
  Instrument: (r, p) => <Link to="/instruments" search={{ search: r.docCode }} {...p} />,
  BOM: (r, p) => <Link to="/bom-masters/$id" params={byId(r)} {...p} />,
  RouteCard: (r, p) => <Link to="/route-cards/$id" params={byId(r)} {...p} />,
  MlBom: (r, p) => <Link to="/ml-boms/$id" params={byId(r)} {...p} />,
};

/** The Doc No. cell: the code, linked to where that document / master opens.
 *  Stops the click so following the link never also toggles the row. */
export function DocEditLink({ row }: { row: DocumentEditRow }): React.JSX.Element {
  return DOCUMENT_EDIT_LINK[row.entity](row, {
    className: 'mono fw-700',
    style: { color: 'var(--blue)' },
    onClick: (e) => e.stopPropagation(),
    children: row.docCode,
  });
}
