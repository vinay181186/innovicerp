// ADR-184 — the before → after trail written on a Sales Order EDIT.
//
// The activity log used to say only "IN-SO-00012 — Customer", which left no
// way to find out who cut a line from 20 to 10 or cancelled it. This builds
// one detail string naming every header field and line that actually changed.
// Pure function: no DB access, so it is cheap to unit test.

const MAX_DETAIL_CHARS = 900;

export interface SoHeaderSnapshot {
  soDate: string | null;
  customerName: string | null;
  clientPoNo: string | null;
  type: string;
  status: string;
  gstPercent: string | null;
  bomMasterId: string | null;
  bomStatus: string | null;
  costCenter: string | null;
  remarks: string | null;
}

export interface SoLineSnapshot {
  id: string;
  lineNo: number;
  itemCode: string | null;
  orderQty: number;
  rate: string | null;
  status: string;
}

function show(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

function sameNumber(a: string | null, b: string | null): boolean {
  return Number(a ?? 0) === Number(b ?? 0);
}

const HEADER_FIELDS: Array<{
  key: keyof SoHeaderSnapshot;
  label: string;
  numeric?: boolean;
}> = [
  { key: 'soDate', label: 'SO Date' },
  { key: 'customerName', label: 'Customer' },
  { key: 'clientPoNo', label: 'Client PO No.' },
  { key: 'type', label: 'SO Type' },
  { key: 'status', label: 'SO Status' },
  { key: 'bomMasterId', label: 'BOM' },
  { key: 'bomStatus', label: 'BOM Status' },
  { key: 'costCenter', label: 'Cost Center' },
  { key: 'remarks', label: 'Remarks' },
];

/**
 * `base` is the old detail ("code — customer"); the changes follow it. Lines
 * are compared only when the save carried lines (`linesBefore` non-null).
 */
export function buildSoEditSummary(
  base: string,
  hdrBefore: SoHeaderSnapshot,
  hdrAfter: SoHeaderSnapshot,
  linesBefore: SoLineSnapshot[] | null,
  linesAfter: SoLineSnapshot[] | null,
): string {
  const changes: string[] = [];

  for (const f of HEADER_FIELDS) {
    const a = hdrBefore[f.key];
    const b = hdrAfter[f.key];
    const same = f.numeric ? sameNumber(a, b) : (a ?? null) === (b ?? null);
    if (!same) changes.push(`${f.label}: ${show(a)} → ${show(b)}`);
  }

  if (linesBefore && linesAfter) {
    const afterById = new Map(linesAfter.map((l) => [l.id, l]));
    const beforeIds = new Set(linesBefore.map((l) => l.id));
    for (const b of [...linesBefore].sort((x, y) => x.lineNo - y.lineNo)) {
      const a = afterById.get(b.id);
      if (!a) {
        changes.push(`Ln ${b.lineNo} (${show(b.itemCode)}) removed`);
        continue;
      }
      const lineChanges: string[] = [];
      if ((b.itemCode ?? null) !== (a.itemCode ?? null)) {
        lineChanges.push(`Item Code ${show(b.itemCode)} → ${show(a.itemCode)}`);
      }
      if (b.orderQty !== a.orderQty) lineChanges.push(`Order Qty ${b.orderQty} → ${a.orderQty}`);
      // Money (rate / GST %) is deliberately NOT logged: the activity log is
      // readable by users whose access hides prices (ADR-184).
      if (!sameNumber(b.rate, a.rate)) lineChanges.push('Rate changed');
      if (b.status !== a.status) lineChanges.push(`Line Status ${b.status} → ${a.status}`);
      if (b.lineNo !== a.lineNo) lineChanges.push(`Ln ${b.lineNo} → ${a.lineNo}`);
      if (lineChanges.length > 0) changes.push(`Ln ${b.lineNo}: ${lineChanges.join(', ')}`);
    }
    for (const a of [...linesAfter].sort((x, y) => x.lineNo - y.lineNo)) {
      if (!beforeIds.has(a.id)) {
        changes.push(`Ln ${a.lineNo} (${show(a.itemCode)}) added, Order Qty ${a.orderQty}`);
      }
    }
  }

  const full =
    changes.length > 0 ? `${base} | ${changes.join('; ')}` : `${base} | no field changed`;
  return full.length > MAX_DETAIL_CHARS ? `${full.slice(0, MAX_DETAIL_CHARS - 3)}...` : full;
}
