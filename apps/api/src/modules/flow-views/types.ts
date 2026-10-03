// Flow views (requirement 3.5 "Make the flows visible") — wire shapes.
//
// READ-ONLY views. Every figure is read from the same sources the rest of the
// app computes from (v_jc_op_status 0176, op_log, nc_register, the plan
// coverage fragments in lib/plan-order-coverage.ts, production_orders). Nothing
// here computes a quantity the screens act on.
//
// packages/shared is frozen for this build, so the shapes live here and the
// web keeps an identical copy in modules/flow-views/types.ts. Change both.

// ─── 1. Op qty flow (Job Card page) ─────────────────────────────────────────

export interface FlowNcRef {
  id: string;
  code: string;
  qty: number;
  disposition: string | null;
  status: string;
}

export interface OpFlowRow {
  jcOpId: string;
  opSeq: number;
  operation: string;
  opType: string;
  qcRequired: boolean;
  /** Op has an outsource lane (outsource op, or in-house op with an OSP balance). */
  hasOsp: boolean;
  /** v_jc_op_status.input_avail — what the previous op passed on (Order Qty on op 1). */
  inputQty: number;
  /** v_jc_op_status.completed_qty. */
  completedQty: number;
  /** v_jc_op_status.qc_accepted_qty. */
  qcAcceptedQty: number;
  /** Rejected at the machine (op_log complete.reject_qty). */
  productionRejectedQty: number;
  /** Rejected at QC on this op (op_log qc.reject_qty). */
  qcRejectedQty: number;
  /** Rejected at Incoming QC on the vendor's return (GRN lines). */
  vendorRejectedQty: number;
  /** Pieces an NC put back on this op (op_log rows LOG-NC-…). */
  reworkedBackQty: number;
  /** NC codes those pieces came from. */
  reworkedBackFrom: string[];
  /** Reversal entries on this op (0179). Their negative qty is already netted in every figure. */
  reversedEntries: number;
  /** Pieces written off on this op — same per-NC rule as 0176 op_loss. */
  lostQty: number;
  /** jc_ops.outsource_sent_qty. */
  sentToVendorQty: number;
  /** Σ GRN lines qc_accepted_qty on the op's PO lines. */
  vendorAcceptedQty: number;
  /** Vendor-rejected pieces sent back on a return-to-vendor challan (NC rtv_sent_qty). */
  returnedToVendorQty: number;
  /** Of those, pieces the vendor sent back again (NC rtv_received_qty). */
  reReceivedQty: number;
  /** Pieces still with the vendor now (v_jc_op_status.at_vendor_qty). */
  atVendorQty: number;
  /** What the NEXT op receives from this one (same CASE as 0176 prev_output). */
  passedOnQty: number;
  /** v_jc_op_status.available. */
  availableQty: number;
  /** v_jc_op_status.qc_pending. */
  qcPendingQty: number;
  /** v_jc_op_status.computed_status. */
  status: string;
  /** Which rule gives Passed On for this op, in plain words. */
  passedOnRule: string;
  ncs: FlowNcRef[];
}

export interface OpFlowResponse {
  jobCardId: string;
  jobCardCode: string;
  orderQty: number;
  ops: OpFlowRow[];
}

// ─── 2. Rework tree (Job Card page) ─────────────────────────────────────────

export interface ReworkTreeNode {
  jobCardId: string;
  code: string;
  parentJobCardId: string | null;
  depth: number;
  /** null = the main card; 'rework' | 'repair' on a recovery child. */
  recoveryKind: string | null;
  orderQty: number;
  status: string | null;
  /** Op of the parent card the pieces came off. */
  originOpSeq: number | null;
  /** The NC on the parent card that raised this child. */
  fromNc: {
    id: string;
    code: string;
    sentQty: number;
    clearedQty: number;
    failedQty: number;
    status: string;
  } | null;
  /** Every NC raised on this card. */
  ncs: (FlowNcRef & { opSeq: number | null; childJobCardId: string | null })[];
}

export interface ReworkTreeResponse {
  jobCardId: string;
  rootJobCardId: string;
  nodes: ReworkTreeNode[];
}

// ─── 3. NC timeline (NC detail page) ────────────────────────────────────────

export type NcTimelineStepKind =
  | 'raised'
  | 'split'
  | 'disposed'
  | 'sent_to_vendor'
  | 'rework_jc'
  | 'received'
  | 'returned_to_op'
  | 're_inspected'
  | 'closed';

export interface NcTimelineStep {
  kind: NcTimelineStepKind;
  label: string;
  /** ISO timestamp or YYYY-MM-DD; null when the step is known but undated. */
  at: string | null;
  user: string | null;
  qty: number | null;
  detail: string | null;
  /** The document this step made, if any. */
  doc: {
    module: 'job-cards' | 'delivery-challans' | 'goods-receipt-notes' | 'nc-register';
    id: string;
    code: string;
  } | null;
}

export interface NcTimelineResponse {
  ncId: string;
  code: string;
  /** Material came from a vendor → the only recovery allowed is Return to vendor. */
  vendorOnly: boolean;
  steps: NcTimelineStep[];
}

// ─── 4. Level matrix (SO detail page) ───────────────────────────────────────

export interface LevelOspDoc {
  kind: 'pr' | 'po' | 'dc' | 'grn';
  id: string;
  code: string;
  status: string | null;
}

export interface LevelJcOp {
  opSeq: number;
  operation: string;
  inputQty: number;
  passedOnQty: number;
  status: string;
}

export interface LevelJobCard {
  id: string;
  code: string;
  orderQty: number;
  status: string | null;
  productionOrderId: string | null;
  ops: LevelJcOp[];
  ospDocs: LevelOspDoc[];
}

export interface LevelProductionOrder {
  id: string;
  code: string;
  planId: string;
  orderQty: number;
  creditedQty: number;
  lostQty: number;
  /** Same rule as production-orders toDetail: 0 once stopped, else Order − Credited. */
  pendingQty: number;
  status: string;
}

export interface LevelPlan {
  id: string;
  code: string;
  planQty: number;
  coveredQty: number;
  pendingQty: number;
  planStatus: string;
  derivedStatus: string | null;
}

export interface LevelSoLine {
  id: string;
  lineNo: number;
  itemCode: string | null;
  partName: string;
  clientPoLineNo: string | null;
  orderQty: number;
  dispatchedQty: number;
  billedQty: number;
  status: string;
  shortClosedAt: string | null;
  plans: LevelPlan[];
  productionOrders: LevelProductionOrder[];
  /** Cards built for this line (by a Production Order or raised on the line); rework children excluded. */
  jobCards: LevelJobCard[];
}

export interface LevelMatrixResponse {
  salesOrderId: string;
  code: string;
  lines: LevelSoLine[];
}
