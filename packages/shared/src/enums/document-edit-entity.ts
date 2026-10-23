import type { AccessFormKey } from './access-control';

// Documents enrolled in edit-approval. The value is the ActivityLog entity
// name (§18 — one fact, one name) so the request's REQUEST / APPROVE / REJECT
// trail renders on the document's own History tab with no new view.
//
// This list grows one batch at a time. Phase 1 enrolled Purchase Order; Phase 2
// adds the other transactional documents (and later masters); Phase 3 adds the
// four documents that gain edit screens. Each value is that document's canonical
// ActivityLog entity name.
export const DOCUMENT_EDIT_ENTITIES = [
  'PurchaseOrder',
  'PurchaseRequest',
  'NonConformance',
  'Plan',
  'SalesOrder',
  'JobWorkOrder',
  'GoodsReceiptNote',
  'JobCard',
  'Dispatch',
  'DeliveryChallan',
  'PartyGrn',
  'ProductionOrder',
  'Item',
  'Vendor',
  'Client',
  'Machine',
  'MachineGroup',
  'Operator',
  'CostCenter',
  'TpiInspector',
  'QcProcess',
  'MaterialGrade',
  'MaterialSize',
  'Instrument',
  'BOM',
] as const;

export type DocumentEditEntity = (typeof DOCUMENT_EDIT_ENTITIES)[number];

// ADR-234 — which Access Control form approves an edit (and, ADR-235, a cancel
// request) of each document type. The API's registry entries carry the same
// `formKey`; document-edits/form-key.test.ts fails if they drift. A full
// Record, so a new entity without a row fails the typecheck.
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

// The tab / row label each enrolled type shows in Settings → Approvals. A full
// Record, so enrolling a new entity without a label fails the typecheck and the
// Approvals page can never again miss a type that the server stages.
export const DOCUMENT_EDIT_LABEL: Readonly<Record<DocumentEditEntity, string>> = {
  PurchaseOrder: 'PO Edit',
  PurchaseRequest: 'PR Edit',
  NonConformance: 'NC',
  Plan: 'Plan',
  SalesOrder: 'SO',
  JobWorkOrder: 'JWSO',
  GoodsReceiptNote: 'GRN',
  JobCard: 'Job Card',
  Dispatch: 'Dispatch',
  DeliveryChallan: 'Delivery Challan',
  PartyGrn: 'Party GRN',
  ProductionOrder: 'Production Order',
  Item: 'Item',
  Vendor: 'Vendor',
  Client: 'Customer',
  Machine: 'Machine',
  MachineGroup: 'Machine Group',
  Operator: 'Operator',
  CostCenter: 'Cost Centre',
  TpiInspector: 'TPI',
  QcProcess: 'QC Process',
  MaterialGrade: 'Material Grade',
  MaterialSize: 'Material Size',
  Instrument: 'Instrument',
  BOM: 'BOM',
};

// The masters share ONE "Masters" tab (a picker inside it chooses the master);
// every other type gets its own tab.
export const DOCUMENT_EDIT_MASTER_ENTITIES = [
  'Item',
  'Vendor',
  'Client',
  'Machine',
  'MachineGroup',
  'Operator',
  'CostCenter',
  'TpiInspector',
  'QcProcess',
  'MaterialGrade',
  'MaterialSize',
  'Instrument',
] as const satisfies readonly DocumentEditEntity[];
