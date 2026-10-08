// ADR-225 / §20.4 — a Job Card's operations as ONE comparable value.
//
// The operations are all-or-nothing on this document, by owner decision
// (ADR-225, "Three places REFUSE rather than merge"): an operation's step number
// IS its position in the array (`updateJobCardTx` parks kept ops at
// `op_seq + 100000` and renumbers from the index), and `ops` carries
// `.default([])`, so an ABSENT ops key means "delete every operation". The whole
// array therefore travels on every save and a routing clash is NOT merged — the
// second save wins and the notice names the other person.
//
// This digest exists so that (a) an OPS-ONLY edit — change a machine, add a step
// — still registers as a change, because `useEditConflict` refuses a save whose
// diff is empty and the header would be untouched; and (b) when a save is
// refused, the screen can tell whether the other person changed the ROUTING
// rather than a header field, and say so.
//
// The comparison rules mirror the server's own `jcOpsChanged` deliberately:
// position + id (so a pure reorder counts), the machine only on a process op and
// the vendor only on an outsource op (the stored columns carry a value only for
// that type). The cost is emitted only when it is a real non-zero number, which
// is what keeps a MASKED cost from reporting a change nobody made: money is
// hidden below L3 in Production, so the model hands back `null` and the blinded
// form posts 0 — neither emits anything, so they agree.

/** Both the SAVED op (JobCardEditModel['ops']) and the OUTGOING op (JcOpInput)
 *  satisfy this, so one function digests both. */
export interface JcOpDigestOp {
  id?: string | undefined;
  machineCode?: string | null | undefined;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: number;
  program?: string | null | undefined;
  toolNo?: string | null | undefined;
  toolDetails?: string | null | undefined;
  qcRequired: boolean;
  outsourceVendorCode?: string | null | undefined;
  outsourceCost?: number | null | undefined;
}

function text(v: string | null | undefined): string {
  return v?.trim() ?? '';
}

export function jcOpsDigest(ops: readonly JcOpDigestOp[]): string {
  const rows = ops.map((o, i) => {
    const parts = [`${i + 1} ${text(o.operation) || '—'}`];
    // A new op (no id) must never digest the same as the saved op in its place.
    parts.push(o.id ?? 'new');
    parts.push(o.opType);
    if (o.opType === 'process' && text(o.machineCode)) parts.push(text(o.machineCode));
    if (o.opType === 'outsource') {
      if (text(o.outsourceVendorCode)) parts.push(text(o.outsourceVendorCode));
      const cost = Number(o.outsourceCost ?? 0);
      if (Number.isFinite(cost) && cost !== 0) parts.push(`cost ${cost}`);
    }
    if (Number(o.cycleTimeMin || 0) !== 0) parts.push(`${Number(o.cycleTimeMin)}m`);
    if (text(o.program)) parts.push(`prog ${text(o.program)}`);
    if (text(o.toolNo)) parts.push(`tool ${text(o.toolNo)}`);
    if (text(o.toolDetails)) parts.push(text(o.toolDetails));
    if (o.qcRequired) parts.push('QC');
    return parts.join(' · ');
  });
  return `${rows.length} operation${rows.length === 1 ? '' : 's'} — ${rows.join(' | ')}`;
}
