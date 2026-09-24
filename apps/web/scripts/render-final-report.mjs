// Render the ERP chain verification rows to ONE PDF + a mapped JSON, offline.
// Usage (from apps/web):  node scripts/render-final-report.mjs
//   Section-only PDF (2026-09-21, R4):
//     node scripts/render-final-report.mjs --only R4 --out test-results/erp-chain-verification-2026-09-21-adr175.pdf --date 2026-09-21
//   --only <prefix[,prefix]>  keep only rows whose id starts with a prefix
//   --out <pdf>               PDF path (the JSON lands beside it, same stem)
//   --date <yyyy-mm-dd>       the date printed on the report
// Uses the already-installed Playwright chromium purely as a printer (setContent + pdf).
// No navigation to any URL, no test run.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const INPUT = resolve(webRoot, '.playwright/erp-chain-report-rows.json');
const OUT_DIR = resolve(webRoot, '.playwright/reports');
const ARGS = process.argv.slice(2);
const argOf = (flag) => {
  const i = ARGS.indexOf(flag);
  return i >= 0 ? ARGS[i + 1] : undefined;
};
const ONLY = (argOf('--only') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const OUT_PDF = argOf('--out') ? resolve(webRoot, argOf('--out')) : resolve(OUT_DIR, 'erp-chain-verification-2026-09-16-FINAL.pdf');
const OUT_JSON = argOf('--out') ? OUT_PDF.replace(/\.pdf$/i, '.json') : resolve(OUT_DIR, 'erp-chain-verification-2026-09-16-FINAL.json');

const REPORT_DATE = argOf('--date') ?? (ONLY.length ? '2026-09-21' : '2026-09-16 · R4 added 2026-09-21');
const TITLE = 'ERP chain verification — test stack';

// ---------------------------------------------------------------------------
// Groups (by row-id prefix) with the manager-readable one-line summary.
// ---------------------------------------------------------------------------
const GROUPS = [
  {
    key: 'T1',
    heading: 'T1 — Rework through child job cards',
    summary:
      'A 12-piece in-house job had 4 rejects reworked in a child card, 1 of those reworked again in a grandchild card; every NC closed, the parent shows 12 of 12 done and the stock ledger credited 12 once.',
  },
  {
    key: 'T2',
    heading: 'T2 — Return to vendor (single cycle) + purchase-GRN observation',
    summary:
      '10 pieces went to the vendor, 3 came back rejected, were returned on a challan, received again and passed QC; the job card and NC closed. Two PO-status badges were stale that day (fixed since, see R1). A plain purchase reject raises no NC by design.',
  },
  {
    key: 'T3',
    heading: 'T3 — Return to vendor, three cycles deep',
    summary:
      'The same op cycled rejects to the vendor three times (3 → 2 → 1); rework is refused on vendor-sourced NCs by design, so the vendor side nests as NC → challan → GRN → NC. All NCs closed and the job card completed; the PO line count was wrong that day (fixed since, see R1).',
  },
  {
    key: 'R1',
    heading: 'R1 — PO quantity right through 4 return cycles (after fix)',
    summary:
      'Fresh 10-piece chain with four return cycles (3, 2, 1, 1): the job-work PO line and header now move correctly on every return challan and every replacement QC, ending at 10 of 10 / Closed with eight adjustment rows in the activity log.',
  },
  {
    key: 'R2',
    heading: 'R2 — Replacement pieces flow on, stock, JC/SO close (after fix)',
    summary:
      'Replacement pieces accepted at Incoming QC now flow on to the next op, the op card shows At Vendor / In QC correctly, stock is credited exactly once, and the job card and sales order close from Incoming QC without an Op Entry.',
  },
  {
    key: 'R3',
    heading: 'R3 — NC chain link, strip counts, PO delete, SO status, JC create (after fix)',
    summary:
      'Follow-on NCs link to the NC they continue, the NC strip counts pieces (not rejections), an open job-work PO can be deleted and the op falls back to PR raised (refused once goods moved), SO Status reflects the outsource op, and a new job card raises its PR on save. The vendor box on Edit now reads code + name (fixed cefa950b).',
  },
  {
    key: 'R4',
    heading: 'R4 — every disposition settles the chain (ADR-175, 2026-09-21)',
    summary:
      'Six fresh 10-piece in-house chains (Turning → Final Inspection, 8 ok / 2 rejected), one NC disposition each: rework, nested rework (child NC continues the first), use as is, scrap, make fresh and repair. After each, the parent op, parent job card (closed date + activity row), child cards, NC ledger, SO Status chips, dispatch-ready qty, stock ledger and SO line were read. Scrap and make fresh leave the origin op at 8 of 10 on purpose (open business rule).',
  },
];

// ---------------------------------------------------------------------------
// Hand-written mapping, keyed by row id.
// [Action (≤6 words, verb first), Document, Qty, Header Status, Overall Status (≤5 words)]
// '' = blank cell.  null document = fall back to the regex on action+actual.
// ---------------------------------------------------------------------------
const MAP = {
  // ---- T1: Rework through child job cards --------------------------------
  'T1-01': ['Create sales order', 'IN-SO-00024', '12', 'Open', 'In progress'],
  'T1-02': ['Plan and raise job card', 'IN-JC-26-00031', '12', '', 'Ready to run'],
  'T1-03': ['Run turning op', 'IN-JC-26-00031', '12', '', '12 awaiting QC'],
  'T1-04': ['QC: 8 ok, 4 reject', 'IN-JC-26-00031', '4', '', 'NC raised 4'],
  'T1-05': ['Check NC detail', 'NC-AUTO-IN-JC-26-00031-Op2-102305978', '4', 'NC Raised', 'Pending'],
  'T1-06': ['Rework 4 in child JC', 'NC-AUTO-IN-JC-26-00031-Op2-102305978', '4', 'Under Rework', 'Child IN-JC-26-00031-RW1 raised'],
  'T1-07': ['Check child job card', 'IN-JC-26-00031-RW1', '4', 'Complete', 'Linked to parent'],
  'T1-08': ['Check parent op card', 'IN-JC-26-00031', '4', '', 'Under rework 4'],
  'T1-09': ['Rework: 3 ok, 1 reject', 'IN-JC-26-00031-RW1', '4', '', 'Second NC raised 1'],
  'T1-10': ['Check second NC', 'NC-AUTO-IN-JC-26-00031-RW1-Op2-102659943', '1', 'NC Raised', 'Pending'],
  'T1-11': ['Rework 1 in grandchild JC', 'NC-AUTO-IN-JC-26-00031-RW1-Op2-102659943', '1', 'Under Rework', 'Child IN-JC-26-00031-RW1-RW1 raised'],
  'T1-12': ['Check grandchild job card', 'IN-JC-26-00031-RW1-RW1', '1', '', 'Linked to parent'],
  'T1-13': ['Rework: 1 ok, 0 reject', 'IN-JC-26-00031-RW1-RW1', '1', 'Closed', 'Complete'],
  'T1-14': ['Check second NC closed', 'NC-AUTO-IN-JC-26-00031-RW1-Op2-102659943', '1', 'Closed', 'Cleared 1 of 1'],
  'T1-15': ['Check first NC closed', 'NC-AUTO-IN-JC-26-00031-Op2-102305978', '4', 'Closed', 'Cleared 4 of 4'],
  'T1-16': ['Check child job card', 'IN-JC-26-00031-RW1', '4', 'Complete', 'NC closed 1'],
  'T1-17': ['Check parent job card', 'IN-JC-26-00031', '12', 'Complete', '12 of 12 done'],
  'T1-18': ['Check job card list', 'IN-JC-26-00031', '', 'Complete', 'All 3 cards listed'],
  'T1-19': ['Check NC register', 'IN-JC-26-00031', '', '', 'Both NCs closed'],

  // ---- T2: Return to vendor (single cycle) + purchase-GRN observation ----
  'T2-01': ['Receive 2 on purchase order', 'IN-GRN-00013', '2', 'QC Pending', 'Against IN-MPO-00002/R1'],
  'T2-02': ['QC: 1 ok, 1 reject', 'IN-GRN-00013', '1', 'Completed', 'By design: no NC'],
  'T2-03': ['Create sales order', 'IN-SO-00025', '10', 'Open', 'In progress'],
  'T2-04': ['Plan outsource op', 'IN-JC-26-00032', '10', 'Complete', 'PR IN-JWPR-00007 auto-raised'],
  'T2-05': ['Raise job-work PO', 'IN-JWPO-00004/R1', '10', 'Open', 'Nothing received yet'],
  'T2-06': ['Send 10 to vendor', 'IN-DC-00014/R1', '10', 'Issued', 'At vendor 10'],
  'T2-07': ['Receive 10 from vendor', 'IN-GRN-00014', '10', 'QC Pending', 'In QC 10'],
  'T2-08': ['QC: 7 ok, 3 reject', 'IN-GRN-00014', '3', 'Completed', 'NC raised 3'],
  'T2-09': ['Check NC detail', 'NC-AUTO-IN-JC-26-00032-Op1-111135795', '3', 'Closed', 'Vendor, PO, GRN linked'],
  'T2-10': ['Return 3 to vendor', 'NC-AUTO-IN-JC-26-00032-Op1-111135795', '3', 'Disposed', 'Awaiting challan'],
  'T2-11': ['Check vendor prefilled', 'NC-AUTO-IN-JC-26-00032-Op1-111135795', '3', '', 'Original vendor prefilled'],
  'T2-12': ['Issue return challan', 'IN-DC-00015/R1', '3', 'Issued', 'At vendor 3'],
  'T2-13': ['Check PO after return', 'IN-JWPO-00004/R1', '3', 'Closed', 'Line 7; header fixed'],
  'T2-14': ['Check op card', 'IN-JC-26-00032', '3', '', 'Sent to vendor 3'],
  'T2-15': ['Receive 3 replacement', 'IN-GRN-00015', '3', 'QC Cleared', 'Against NC'],
  'T2-16': ['Check NC before QC', 'NC-AUTO-IN-JC-26-00032-Op1-111135795', '3', 'Received – QC Pending', 'In QC 3'],
  'T2-17': ['QC: 3 ok, 0 reject', 'IN-GRN-00015', '3', 'Completed', 'NC closed, cleared 3'],
  'T2-18': ['Check PO after replacement', 'IN-JWPO-00004/R1', '10', 'Partial', 'Line 10; header fixed'],
  'T2-19': ['Check op card', 'IN-JC-26-00032', '10', 'Complete', 'NC closed 3'],
  'T2-20': ['Check return challan', 'IN-DC-00015/R1', '3', 'Received', '1 receipt of 3'],
  'T2-21': ['Check stock ledger', 'IN-GRN-00014', '10', '', '+7 and +3 credited'],
  'T2-22': ['Check NC register', 'IN-JC-26-00032', '3', 'Closed', 'Return to vendor'],

  // ---- T3: Return to vendor, three cycles deep ---------------------------
  'T3-01': ['Build chain to first return', 'NC-AUTO-IN-JC-26-00033-Op1-113210117', '3', 'Received – QC Pending', 'Replacement 3 in QC'],
  'T3-02': ['QC: 1 ok, 2 reject', 'IN-GRN-00017', '2', 'Completed', 'Follow-on NC raised 2'],
  'T3-03': ['Try rework on vendor NC', 'NC-AUTO-IN-JC-26-00033-Op1-113418695', '2', 'NC Raised', 'Refused: vendor-sourced'],
  'T3-04': ['Check child job card', 'IN-JC-26-00033', '', '', 'By design'],
  'T3-05': ['Return 2 to vendor', 'IN-DC-00018/R1', '2', 'Issued', 'PO showed 6; fixed'],
  'T3-06': ['Receive 2; 1 ok, 1 reject', 'IN-GRN-00018', '2', 'Completed', 'Follow-on NC raised 1'],
  'T3-07': ['Try rework on vendor NC', 'NC-AUTO-IN-JC-26-00033-Op1-120540676', '1', 'NC Raised', 'Refused: vendor-sourced'],
  'T3-08': ['Return 1 and receive back', 'IN-DC-00019/R1', '1', 'Received', 'Replacement 1 in QC'],
  'T3-09': ['QC: 1 ok, 0 reject', 'NC-AUTO-IN-JC-26-00033-Op1-120540676', '1', 'Closed', 'Cleared 1'],
  'T3-10': ['Check all three NCs', 'NC-AUTO-IN-JC-26-00033-Op1-113210117', '6', 'Closed', 'All three closed'],
  'T3-11': ['Check top job card', 'IN-JC-26-00033', '10', 'Complete', 'NC closed 6'],
  'T3-12': ['Check PO at the end', 'IN-JWPO-00005/R1', '10', 'Partial', 'Line 7 of 10; fixed'],
  'T3-13': ['Check challans and GRNs', 'IN-DC-00017/R1', '', 'Received', 'All received, NC-linked'],
  'T3-14': ['Check grandchild job card', 'IN-JC-26-00033', '', '', 'By design'],

  // ---- R1: PO quantity right through 4 return cycles (after fix) ----------
  'R1-01': ['Build chain and receive 10', 'IN-JWPO-00007/R1', '10', 'QC Pending', 'In QC 10'],
  'R1-02': ['QC: 7 ok, 3 reject', 'IN-JWPO-00007/R1', '3', 'Closed', 'First NC raised 3'],
  'R1-A1': ['Return 3 to vendor', 'IN-JWPO-00007/R1', '3', 'Partial', '3 out on IN-DC-00022/R1'],
  'R1-A2': ['Receive 3 replacement', 'IN-GRN-00022', '3', 'QC Pending', 'PO line stays 7'],
  'R1-A3': ['QC: 1 ok, 2 reject', 'IN-JWPO-00007/R1', '3', 'Closed', 'Back to 10; NC-B raised'],
  'R1-B1': ['Return 2 to vendor', 'IN-JWPO-00007/R1', '2', 'Partial', '2 out on IN-DC-00024/R1'],
  'R1-B2': ['Receive 2 replacement', 'IN-GRN-00024', '2', 'QC Pending', 'PO line stays 8'],
  'R1-B3': ['QC: 1 ok, 1 reject', 'IN-JWPO-00007/R1', '2', 'Closed', 'Back to 10; NC-C raised'],
  'R1-C1': ['Return 1 to vendor', 'IN-JWPO-00007/R1', '1', 'Partial', '1 out on IN-DC-00025/R1'],
  'R1-C2': ['Receive 1 replacement', 'IN-GRN-00025', '1', 'QC Pending', 'PO line stays 9'],
  'R1-C3': ['QC: 0 ok, 1 reject', 'IN-JWPO-00007/R1', '1', 'Closed', 'Back to 10; NC-D raised'],
  'R1-D1': ['Return 1 to vendor', 'IN-JWPO-00007/R1', '1', 'Partial', '1 out on IN-DC-00026/R1'],
  'R1-D2': ['Receive 1 replacement', 'IN-GRN-00026', '1', 'QC Pending', 'PO line stays 9'],
  'R1-D3': ['QC: 1 ok, 0 reject', 'IN-JWPO-00007/R1', '1', 'Closed', 'Back to 10; all done'],
  'R1-Z1': ['Check PO at the end', 'IN-JWPO-00007/R1', '10', 'Closed', '10 of 10; fixed'],
  'R1-Z2': ['Check NCs and op card', 'IN-JC-26-00035', '10', 'Complete', 'All four NCs closed'],
  'R1-Z3': ['Check PO activity log', 'IN-JWPO-00007/R1', '', '', '8 adjustments in order'],

  // ---- R2: Replacement pieces flow on, stock, JC/SO close (after fix) ----
  'R2-01-M1a': ['Build chain and receive 10', 'IN-JC-26-00039', '10', 'Received', 'In QC 10; 2 ops'],
  'R2-02-M1': ['QC: 7 ok, 3 reject', 'IN-JC-26-00039', '3', 'Received', 'NC raised 3; mirrored 7'],
  'R2-03-M2': ['Return 3 to vendor', 'IN-JC-26-00039', '3', 'Sent', 'At vendor 3 (IN-DC-00033/R1)'],
  'R2-04-M3': ['Receive 3 replacement', 'IN-JC-26-00039', '3', 'Received', 'In QC 3 (IN-GRN-00033)'],
  'R2-05-M4': ['QC: 2 ok, 1 reject', 'IN-JC-26-00039', '3', 'Received', 'Mirrored 9; NC-B raised 1'],
  'R2-06-M5': ['Cycle last 1 through vendor', 'IN-JC-26-00039', '1', 'Received', 'Op complete; mirrored 10'],
  'R2-07-M5b': ['Check job card closes', 'IN-JC-26-00039', '10', 'Closed', 'Closed without Op Entry'],
  'R2-08-M6': ['Check stock ledger', 'IN-JC-26-00039', '10', '', 'Credited 10 once'],
  'R2-09-M7': ['Build chain G, check sendable', 'IN-JC-26-00040', '4', 'Sent', 'Can send 4; nothing saved'],
  'R2-10-L1': ['Run last-op chain, 6 ok', 'IN-JC-26-00041', '6', 'Closed', 'SO IN-SO-00031 closed'],
  'R2-11-L2': ['Check stock ledger', 'IN-GRN-00036', '6', '', 'Credited once at GRN'],
  'R2-12-REG': ['Re-check earlier chain', 'IN-JWPO-00007/R1', '10', 'Closed', 'Unchanged after migration'],
  'R2-13-OSP': ['Check at-vendor register', 'IN-JC-26-00040', '', '', 'No row over sent'],
  'R2-14-G2': ['Check op card after return', 'IN-JC-26-00040', '2', 'In Progress', 'At vendor 2; ready 4'],
  'R2-15-G3': ['Receive 2 replacement', 'IN-JC-26-00040', '2', 'In Progress', 'In QC 2 (IN-GRN-00037)'],
  'R2-16-G4': ['QC: 2 ok, 0 reject', 'IN-JC-26-00040', '2', 'In Progress', 'Done 6; can send 4'],
  'R2-17-G5': ['Check stock ledger', 'IN-GRN-00035', '6', '', '+4 and +2 credited'],
  'R2-18-L3': ['Check SO and job card', 'IN-SO-00031', '6', 'Closed', 'Closed from Incoming QC'],
  'R2-19-M8': ['Check SO and job card', 'IN-SO-00029', '10', 'Closed', 'JC IN-JC-26-00039 closed'],
  'R2-20-M9': ['Check challans, GRNs, NCs', 'IN-DC-00032/R1', '', 'Received', 'All received; NCs closed'],
  'R2-21-M10': ['Check job card final state', 'IN-JC-26-00039', '10', 'Closed', '2 of 2 ops complete'],
  'R2-22-OSP2': ['Check register and store', 'IN-JC-26-00040', '', '', 'At vendor 0 everywhere'],

  // ---- R3: NC chain link, strip counts, PO delete, SO status, JC create --
  'R3-01-1': ['Check NC strip count', 'IN-JC-26-00039', '3', '', 'Counts pieces, not rejections'],
  'R3-01b-1': ['Check NC strip count', 'IN-JC-26-00035', '3', '', 'Counts pieces, not rejections'],
  'R3-02-1': ['Check NC continues link', 'NC-AUTO-IN-JC-26-00039-Op1-054525852', '', 'Closed', 'Linked to previous NC'],
  'R3-02-2': ['Check follow-on NC list', 'NC-AUTO-IN-JC-26-00039-Op1-054149773', '', 'Closed', 'Lists follow-on NC'],
  'R3-02b-1': ['Check NC continues link', 'NC-AUTO-IN-JC-26-00035-Op1-041638457', '', 'Closed', 'Linked to previous NC'],
  'R3-02b-2': ['Check follow-on NC list', 'NC-AUTO-IN-JC-26-00035-Op1-041332404', '', 'Closed', 'Lists follow-on NC'],
  'R3-02b2-1': ['Check NC continues link', 'NC-AUTO-IN-JC-26-00035-Op1-041940116', '', 'Closed', 'Linked to previous NC'],
  'R3-02b2-2': ['Check follow-on NC list', 'NC-AUTO-IN-JC-26-00035-Op1-041638457', '', 'Closed', 'Lists follow-on NC'],
  'R3-02b3-1': ['Check NC continues link', 'NC-AUTO-IN-JC-26-00035-Op1-042240450', '', 'Closed', 'Linked to previous NC'],
  'R3-02b3-2': ['Check follow-on NC list', 'NC-AUTO-IN-JC-26-00035-Op1-041940116', '', 'Closed', 'Lists follow-on NC'],
  'R3-02c-1': ['QC: 1 ok, 1 reject', 'NC-AUTO-IN-JC-26-00042-Op1-063717375', '1', 'Closed', 'Linked to previous NC'],
  'R3-02c-2': ['Check follow-on NC list', 'NC-AUTO-IN-JC-26-00042-Op1-063344478', '', 'Closed', 'Lists follow-on NC'],
  'R3-02c-3': ['Check NC strip mid-way', 'IN-JC-26-00042', '1', '', 'NC closed 1, raised 1'],
  'R3-02d-1': ['Walk NC chain upward', 'NC-AUTO-IN-JC-26-00035-Op1-042240450', '', '', 'Chain of 4 reachable'],
  'R3-03-1': ['Dispose 2, challan pending', 'IN-JC-26-00042', '2', 'In Progress', 'Return challan pending 2'],
  'R3-03-2': ['Check NC after dispose', 'NC-AUTO-IN-JC-26-00042-Op1-063344478', '2', 'Disposed', 'Awaiting challan'],
  'R3-03-3': ['Check PO before challan', 'IN-JWPO-00014/R1', '6', 'Closed', 'Line 6 of 6'],
  'R3-03b-1': ['Issue return challan', 'IN-JC-26-00042', '2', 'Sent', 'At vendor 2 (IN-DC-00039/R1)'],
  'R3-03b-2': ['Check vendor prefilled', 'IN-DC-00039/R1', '2', '', 'Original vendor prefilled'],
  'R3-03b-3': ['Check NC after challan', 'NC-AUTO-IN-JC-26-00042-Op1-063344478', '2', 'Sent To Vendor', 'At vendor 2'],
  'R3-03b-4': ['Check PO after challan', 'IN-JWPO-00014/R1', '2', 'Partial', 'Line 4 of 6'],
  'R3-03c-1': ['Cycle last 1 through vendor', 'IN-JC-26-00042', '1', 'Closed', 'NC closed 2; JC closed'],
  'R3-03c-2': ['Check first NC closed', 'NC-AUTO-IN-JC-26-00042-Op1-063344478', '2', 'Closed', 'Cleared 1, failed 1'],
  'R3-03c-3': ['Check second NC closed', 'NC-AUTO-IN-JC-26-00042-Op1-063717375', '1', 'Closed', 'Cleared 1'],
  'R3-03c-4': ['Check PO at the end', 'IN-JWPO-00014/R1', '6', 'Closed', 'Line 6 of 6'],
  'R3-04a-1': ['Raise job-work PO', 'IN-JWPO-00018/R1', '6', 'Open', 'Nothing received yet'],
  'R3-04a-2': ['Check op card after PO', 'IN-JC-26-00044', '6', 'PO Created', 'Linked to IN-JWPR-00019'],
  'R3-04a-3': ['Check PR fully ordered', 'IN-JWPR-00019', '6', 'PO Created', 'Balance 0'],
  'R3-04b-1': ['Delete purchase order', 'IN-JWPO-00018/R1', '', '', 'Deleted'],
  'R3-04b-2': ['Check op card after delete', 'IN-JC-26-00044', '', 'PR Raised', 'Back to PR raised'],
  'R3-04b-3': ['Check PR re-opened', 'IN-JWPR-00019', '6', 'Open', 'Balance 6 restored'],
  'R3-04b-4': ['Check activity log rows', 'IN-JC-26-00044', '', '', 'JC and PR rows logged'],
  'R3-04c-1': ['Raise second PO for 4', 'IN-JWPO-00016/R1', '4', 'Open', 'Nothing received yet'],
  'R3-04c-2': ['Check op card after PO', 'IN-JC-26-00043', '4', 'PO Created', 'Linked to IN-JWPO-00016/R1'],
  'R3-04c-3': ['Check PR balance', 'IN-JWPR-00018', '4', 'PO Created', 'Ordered 4, balance 2'],
  'R3-05-1': ['Delete PO with goods moved', 'IN-JWPO-00012/R1', '', 'Partial', 'Refused: goods moved'],
  'R3-05-2': ['Check op card unchanged', 'IN-JC-26-00040', '', '', 'Untouched'],
  'R3-06-1': ['Check SO status page', 'IN-SO-00029', '10', 'Complete', 'Op complete; at vendor 0'],
  'R3-06-2': ['Check SO overview', 'IN-SO-00029', '10', 'Completed', 'Closed, 100%'],
  'R3-06b-1': ['Check SO status page', 'IN-SO-00030', '6', 'In Progress', 'Done 6 of 10'],
  'R3-06b-2': ['Check SO overview', 'IN-SO-00030', '6', 'In Progress', 'Open, 60%'],
  'R3-06c-1': ['Check SO status page', 'IN-SO-00031', '6', 'Complete', 'Op complete; at vendor 0'],
  'R3-06c-2': ['Check SO overview', 'IN-SO-00031', '6', 'Completed', 'Closed, 100%'],
  'R3-07-1': ['Raise job card from JWSO', 'IN-JC-26-00045', '6', 'PR Raised', 'IN-JWPR-00020 raised on save'],
  'R3-07-2': ['Check PR after save', 'IN-JWPR-00020', '6', 'Open', 'Balance 6'],
  'R3-07-3': ['Check activity log', 'IN-JC-26-00045', '6', '', 'Create row names PR'],
  'R3-07a-1': ['Search vendor in new card', 'IN-JC-26-00047', '', '', 'Vendor found (fixed)'],
  'R3-07a-2': ['Search second vendor', 'IN-JC-26-00047', '', '', 'First row kept vendor'],
  'R3-07a-3': ['Save job card', 'IN-JC-26-00047', '', '', 'Ops carry both vendors'],
  'R3-07a-4': ['Check source label', 'IN-JC-26-00047', '6', '', 'JWSO IN-JW-00002 picked'],
  'R3-07b-1': ['Check vendor box on edit', 'IN-JC-26-00043', '', '', 'Shows CODE — Name'],
  'R3-07b-2': ['Search vendor on edit', 'IN-JC-26-00047', '', '', 'Vendor found'],
  'R3-07c-1': ['Check vendor box in modal', 'IN-JC-26-00001', '', '', 'Shows CODE — Name'],
  'R3-07r-1': ['Re-check vendor search, new card', '', '', '', 'Vendor found; nothing saved'],
  'R3-07r-2': ['Re-check vendor search on edit', 'IN-JC-26-00047', '', '', 'Vendor found; nothing saved'],
  'R3-08a-1': ['Raise second PO for 2', 'IN-JWPO-00017/R1', '2', '', 'Can send 2'],
  'R3-08a-2': ['Check op card, two POs', 'IN-JC-26-00043', '6', 'PO Created', 'Two live PO links'],
  'R3-08a-3': ['Check PR fully ordered', 'IN-JWPR-00018', '6', 'PO Created', 'Balance 0'],
  'R3-08b-1': ['Cycle 2 through second PO', 'IN-JC-26-00043', '2', 'In Progress', 'Done 2; ready 4'],
  'R3-08b-2': ['Check GRN PO link', 'IN-GRN-00041', '2', '', 'Against IN-JWPO-00017/R1'],
  'R3-08b-3': ['Check second PO', 'IN-JWPO-00017/R1', '2', 'Closed', 'Line 2 of 2'],
  'R3-08b-4': ['Check first PO', 'IN-JWPO-00016/R1', '', 'Open', 'Line 0 of 4'],
  'R3-08b-5': ['Check at-vendor register', 'IN-JC-26-00043', '2', '', 'Sent 2, returned 2'],
  'R3-10-1': ['Use 2 as is', 'IN-JC-26-00046', '2', 'Complete', 'NC closed 2'],
  'R3-10-2': ['Check NC closed', 'NC-AUTO-IN-JC-26-00046-Op10-075636115', '2', 'Closed', 'Use as is'],
};

// Rows that FAILED on 2026-09-15 / in the morning run and were fixed + re-proven.
const FIXED_IDS = new Set(['T2-13', 'T2-18', 'T3-05', 'T3-12', 'R3-07a-1', 'R3-07b-1']);

// ---------------------------------------------------------------------------
// Findings (≤ 8 bullets, plain English, technical ids in parentheses at the end)
// ---------------------------------------------------------------------------
const FINDINGS = [
  'Fixed and re-proven: when you Edit a saved job card, the outsource op\'s vendor box now reads code + name ("VND-959 — E2E_ Shreeji Precision Heat Treaters Pvt Ltd") within about 7 seconds of load, both from Job Cards → Edit and from the Status page → Edit Job Card — the shared picker now follows the name as it resolves. Earlier it stopped at the bare code. (R3-07b-1, IN-JC-26-00043; commit cefa950b)',
  'Re-proven: the "Outsource balance" pop-up on a started in-house op has a searchable vendor box — it starts empty because an in-house op has no vendor yet, typing "959" finds VND-959 and the box then reads code + name; Cancel closes it. The earlier ✗ was the test runner\'s Escape key raising the exit prompt over the pop-up. (R3-07c-1, IN-JC-26-00001)',
  'By design: a reject at Incoming QC on a plain purchase GRN raises no NC and offers no return-to-vendor challan — job-work returns only for now. (T2-02, IN-GRN-00013 / IN-MPO-00002/R1)',
  'By design: Rework is not offered on an NC whose material came from a vendor — the app says return it to the vendor; so no child job card can ever hang under an outsource op, at any depth. Child-in-child rework is proven on the in-house side instead. (T3-03, T3-04, T3-07, T3-14)',
  'Fixed and re-proven: the job-work PO badge that stayed "Closed"/"Partial" after a return challan or a replacement QC, and the PO line that ended at 7 of 10, now move correctly through four return cycles. (T2-13, T2-18, T3-05, T3-12 → R1; ADR-165)',
  'Fixed and re-proven: the vendor picker on a new job card now searches the server, so vendors beyond the first 200 (VND-959) can be picked and saved. (R3-07a, commit 58154c54)',
  'Cosmetic only: the return challan header prints the NC code in capitals, and the grandchild rework card says CLOSED where its parents say COMPLETE for the same finished state. (T2-12, T1-18)',
  'Deploy note: on production, apply migration 0129 and the API together so no NC is created in the gap without its "Continues NC" link. (R3-02)',
];

// ---------------------------------------------------------------------------
const DOC_RE = /(NC-AUTO-[A-Z0-9-]+?-Op\d+-\d+|IN-JC-26-\d+(?:-RW\d+)*|IN-[A-Z]+-\d+(?:\/R\d+)?)/;

function fallbackDoc(row) {
  const m = DOC_RE.exec(`${row.action || ''} ${row.actual || ''}`);
  return m ? m[1] : '';
}

function resultCell(row) {
  const r = String(row.result || '').toUpperCase();
  if (r === 'PASS' || r === 'FIXED' || FIXED_IDS.has(row.id)) return { label: '✓ Pass', cls: 'pass', bucket: 'pass' };
  if (r.startsWith('BLOCKED')) return { label: '◌ By design', cls: 'design', bucket: 'design' };
  if (r.startsWith('N/A')) return { label: '— N/A', cls: 'na', bucket: 'na' };
  if (r === 'FAIL') return { label: '✗ Fail', cls: 'fail', bucket: 'fail' };
  throw new Error(`Unknown result "${row.result}" on ${row.id}`);
}

function words(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
async function main() {
  const src = JSON.parse(readFileSync(INPUT, 'utf8'));
  const rows = ONLY.length ? src.rows.filter((r) => ONLY.some((pfx) => r.id.startsWith(pfx))) : src.rows;
  const site = src.stack || 'https://innovic-erp.pages.dev';

  // Validate the mapping covers every row and nothing else.
  const ids = new Set(rows.map((r) => r.id));
  // R4 rows (2026-09-21) carry their own six-column fields (rec3 + act); no hand map.
  const selfMapped = (r) => r.id.startsWith('R4');
  const missing = rows.filter((r) => !MAP[r.id] && !selfMapped(r)).map((r) => r.id);
  const extra = Object.keys(MAP).filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`Rows without a mapping: ${missing.join(', ')}`);
  if (extra.length && !ONLY.length) throw new Error(`Mapping ids not in input: ${extra.join(', ')}`);

  const mapped = rows.map((row) => {
    const [action, doc, qty, header, overall] = selfMapped(row)
      ? [row.action, row.document ?? '', row.qty ?? '', row.headerStatus ?? '', row.overallStatus ?? '']
      : MAP[row.id];
    if (words(action) > 6) throw new Error(`${row.id}: action > 6 words: "${action}"`);
    if (words(overall) > 5) throw new Error(`${row.id}: overall > 5 words: "${overall}"`);
    if (qty && !/^\d+$/.test(qty)) throw new Error(`${row.id}: qty not digits: "${qty}"`);
    const res = resultCell(row);
    return {
      id: row.id,
      group: row.id.split('-')[0],
      action,
      document: doc == null ? fallbackDoc(row) : doc,
      qty,
      headerStatus: header,
      overallStatus: overall,
      result: res.label,
      resultBucket: res.bucket,
      sourceResult: row.result,
      fixed: FIXED_IDS.has(row.id),
      shot: row.shot || '',
      at: row.at || '',
    };
  });

  const counts = { pass: 0, na: 0, design: 0, fail: 0 };
  for (const m of mapped) counts[m.resultBucket]++;
  const summaryLine = `${counts.pass} pass · ${counts.na} n/a · ${counts.design} by design · ${counts.fail} failure${counts.fail === 1 ? '' : 's'}`;

  // ---- HTML -------------------------------------------------------------
  const groupHtml = GROUPS.filter((g) => !ONLY.length || ONLY.includes(g.key)).map((g) => {
    const gRows = mapped.filter((m) => m.group === g.key);
    const gc = { pass: 0, na: 0, design: 0, fail: 0 };
    for (const m of gRows) gc[m.resultBucket]++;
    const tally = [
      `${gc.pass} pass`,
      gc.na ? `${gc.na} n/a` : '',
      gc.design ? `${gc.design} by design` : '',
      gc.fail ? `${gc.fail} fail` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const body = gRows
      .map(
        (m) => `<tr>
  <td class="c-action"><span class="rid">${esc(m.id)}</span>${esc(m.action)}</td>
  <td class="c-doc">${esc(m.document)}</td>
  <td class="c-qty">${esc(m.qty)}</td>
  <td class="c-hdr">${esc(m.headerStatus)}</td>
  <td class="c-ovr">${esc(m.overallStatus)}</td>
  <td class="c-res"><span class="res ${m.resultBucket}">${esc(m.result)}</span></td>
</tr>`,
      )
      .join('\n');
    return `<section class="group">
  <h2>${esc(g.heading)} <span class="tally">${esc(tally)}</span></h2>
  <p class="gsum">${esc(g.summary)}</p>
  <table>
    <colgroup>
      <col style="width:22%"><col style="width:14%"><col style="width:5%"><col style="width:14%"><col style="width:20%"><col style="width:8%">
    </colgroup>
    <thead><tr><th>Action</th><th>Document</th><th class="c-qty">Qty</th><th>Header Status</th><th>Overall Status</th><th>Result</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
</section>`;
  }).join('\n');

  const findingsShown = ONLY.length ? FINDINGS.filter((f) => ONLY.some((pfx) => f.includes('(' + pfx) || f.includes(' ' + pfx + '-'))) : FINDINGS;
  const findingsHtml = findingsShown.map((f) => `<li>${esc(f)}</li>`).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(TITLE)} — ${REPORT_DATE}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font: 9.5pt/1.35 -apple-system, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; }
  h1 { font-size: 16pt; margin: 0 0 2pt; font-weight: 700; }
  .meta { color: #555; margin: 0 0 4pt; }
  .meta a { color: #555; text-decoration: none; }
  .summary { font-size: 11pt; font-weight: 600; margin: 0 0 10pt; padding: 5pt 8pt; border: 1px solid #d8d8d8; border-radius: 3pt; background: #f7f7f7; }
  .legend { color: #666; font-size: 8.5pt; margin: 0 0 10pt; }
  .group { margin-top: 12pt; }
  h2 { font-size: 11.5pt; margin: 0 0 3pt; padding-bottom: 2pt; border-bottom: 1.5px solid #333; page-break-after: avoid; }
  h2 .tally { font-weight: 400; color: #666; font-size: 9pt; margin-left: 6pt; }
  .gsum { margin: 0 0 5pt; color: #333; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { padding: 3pt 5pt; vertical-align: top; text-align: left; border-bottom: 1px solid #e3e3e3; overflow-wrap: anywhere; word-break: break-word; }
  th { background: #ececec; font-weight: 700; font-size: 9pt; border-bottom: 1px solid #bbb; }
  tbody tr:nth-child(even) td { background: #f6f6f6; }
  .rid { display: inline-block; min-width: 46pt; margin-right: 4pt; color: #999; font-size: 7.5pt; font-family: ui-monospace, Consolas, "Courier New", monospace; }
  .c-doc { font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 8.5pt; font-weight: 700; }
  .c-qty { text-align: right; font-variant-numeric: tabular-nums; }
  .res { font-weight: 700; white-space: nowrap; }
  .res.pass { color: #1a7f37; }
  .res.fail { color: #c62828; }
  .res.design, .res.na { color: #777; }
  .findings { margin-top: 16pt; page-break-inside: avoid; }
  .findings h2 { border-bottom: 1.5px solid #333; }
  .findings ul { margin: 4pt 0 0; padding-left: 16pt; }
  .findings li { margin: 0 0 3pt; }
</style>
</head>
<body>
  <h1>${esc(TITLE)}</h1>
  <p class="meta">Date ${REPORT_DATE} · Site <a href="${esc(site)}">${esc(site)}</a> · ${mapped.length} steps</p>
  <p class="summary">${esc(summaryLine)}</p>
${process.env.PROD_NOTE ? `  <p class="meta">${esc(process.env.PROD_NOTE)}</p>\n` : ''}
  <p class="legend">✓ Pass = worked as required (rows that failed on 15 Sep and were fixed and re-proven are counted as Pass) · ✗ Fail = still not right · ◌ By design = the app refused on purpose · — N/A = observation only. Qty = pieces that moved in that step. Header Status = the badge seen on that document.</p>
${groupHtml}
  <section class="findings">
    <h2>Findings</h2>
    <ul>
${findingsHtml}
    </ul>
  </section>
</body>
</html>`;

  // ---- Outputs ----------------------------------------------------------
  mkdirSync(OUT_DIR, { recursive: true });
  // Optional: dump the HTML for eyeballing (REPORT_HTML_OUT=<path>).
  if (process.env.REPORT_HTML_OUT) writeFileSync(process.env.REPORT_HTML_OUT, html);
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        title: TITLE,
        date: REPORT_DATE,
        site,
        generatedAt: new Date().toISOString(),
        summary: summaryLine,
        counts,
        groups: GROUPS.filter((g) => !ONLY.length || ONLY.includes(g.key)).map((g) => ({ key: g.key, heading: g.heading, summary: g.summary })),
        columns: ['Action', 'Document', 'Qty', 'Header Status', 'Overall Status', 'Result'],
        rows: mapped,
        findings: findingsShown,
      },
      null,
      2,
    ),
  );

  // Playwright chromium as a printer only. Prefer `playwright`, fall back to `@playwright/test`.
  let pw;
  try {
    pw = await import('playwright');
  } catch {
    pw = await import('@playwright/test');
  }
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: OUT_PDF,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:7.5pt;color:#777;padding:0 12mm;display:flex;justify-content:space-between;font-family:-apple-system,Segoe UI,system-ui,Arial,sans-serif;">' +
        `<span>${esc(TITLE)} · ${REPORT_DATE}</span>` +
        '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }

  console.log(`PDF : ${OUT_PDF}`);
  console.log(`JSON: ${OUT_JSON}`);
  console.log(`Summary: ${summaryLine}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
