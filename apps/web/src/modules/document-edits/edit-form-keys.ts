// ADR-234 — which Access Control form approves an edit request of each
// document type. Mirrors `formKey` in apps/api/src/modules/document-edits/
// registry.ts (the server's decide checks `<formKey>.approve`). A full Record,
// so adding an entity to DOCUMENT_EDIT_ENTITIES without a row here fails the
// typecheck. Kept here because packages/shared was frozen for this change; it
// belongs beside DOCUMENT_EDIT_ENTITIES in shared.
import type { AccessFormKey, DocumentEditEntity } from '@innovic/shared';

export const DOCUMENT_EDIT_FORM_KEY: Readonly<Record<DocumentEditEntity, AccessFormKey>> = {
  PurchaseOrder: 'po_create',
  PurchaseRequest: 'pr_create',
  NonConformance: 'nc_dispose',
  Plan: 'plan_create',
  SalesOrder: 'so_create',
  JobWorkOrder: 'jw_create',
  GoodsReceiptNote: 'grn_create',
  JobCard: 'jc_create',
  Dispatch: 'dispatch_create',
  DeliveryChallan: 'ospdc_create',
  PartyGrn: 'party_create',
  ProductionOrder: 'prodorder_create',
  Item: 'item_create',
  Vendor: 'vendor_create',
  Client: 'client_create',
  Machine: 'machine_create',
  MachineGroup: 'machine_create',
  Operator: 'operator_create',
  CostCenter: 'cc_create',
  TpiInspector: 'tpimaster_create',
  QcProcess: 'qcprocess_create',
  MaterialGrade: 'rawmat_create',
  MaterialSize: 'rawmat_create',
  Instrument: 'toolissue_create',
  BOM: 'bom_create',
};
